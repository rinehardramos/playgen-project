#!/usr/bin/env tsx
/**
 * scan-music.ts
 *
 * Scan a local directory for audio files, extract metadata via ffprobe,
 * and import them into the PlayGen song library. Optionally transcode
 * to HLS segments and upload to R2.
 *
 * Usage:
 *   pnpm tsx scripts/scan-music.ts --dir ~/Documents/torrents --station <id-or-slug>
 *   pnpm tsx scripts/scan-music.ts --dir ~/Music --station metro-manila-mix --transcode
 *   pnpm tsx scripts/scan-music.ts --dir ~/Music --dry-run
 *
 * Environment:
 *   DATABASE_URL          — local PG connection (reads from .env)
 *   MUSIC_SCAN_DIR        — default scan directory (overridden by --dir)
 *   S3_BUCKET, S3_ENDPOINT, etc. — for --transcode mode
 */

import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

// ── Load .env ─────────────────────────────────────────────────────────────
const envPath = path.join(import.meta.dirname ?? __dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const scanDir = getArg('dir') ?? process.env.MUSIC_SCAN_DIR ?? '';
const stationArg = getArg('station') ?? '';
const dryRun = hasFlag('dry-run');
const doTranscode = hasFlag('transcode');
const recursive = !hasFlag('no-recursive'); // recursive by default, --no-recursive to disable
const extensions = (getArg('ext') ?? process.env.MUSIC_SCAN_EXTENSIONS ?? 'mp3,flac,wav,m4a,ogg,aac,wma').split(',');

if (!scanDir) {
  console.error('Usage: pnpm tsx scripts/scan-music.ts --dir <path> --station <id-or-slug> [--transcode] [--no-recursive] [--dry-run]');
  process.exit(1);
}

if (!fs.existsSync(scanDir)) {
  console.error(`Directory not found: ${scanDir}`);
  process.exit(1);
}

// ── DB connection ─────────────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL ?? `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:15432/${process.env.POSTGRES_DB}`;
const pool = new pg.Pool({ connectionString: dbUrl });

// ── Audio file discovery ──────────────────────────────────────────────────
interface AudioFile {
  path: string;
  filename: string;
  ext: string;
}

function walkDir(dir: string, recurse = true): AudioFile[] {
  const files: AudioFile[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && recurse) {
        files.push(...walkDir(fullPath, true));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (extensions.includes(ext)) {
          files.push({ path: fullPath, filename: entry.name, ext });
        }
      }
    }
  } catch (err) {
    console.warn(`  ⚠ Cannot read ${dir}: ${err instanceof Error ? err.message : err}`);
  }
  return files;
}

// ── Metadata extraction ───────────────────────────────────────────────────
interface SongMeta {
  title: string;
  artist: string;
  album: string | null;
  duration_sec: number | null;
  genre: string | null;
  filePath: string;
}

async function extractMetadata(filePath: string): Promise<SongMeta> {
  const filename = path.basename(filePath, path.extname(filePath));
  let title = filename;
  let artist = 'Unknown Artist';
  let album: string | null = null;
  let duration_sec: number | null = null;
  let genre: string | null = null;

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', filePath,
    ], { timeout: 10000 });

    const info = JSON.parse(stdout);
    const fmt = info.format ?? {};
    const tags = fmt.tags ?? {};

    // Duration
    if (fmt.duration) duration_sec = Math.round(parseFloat(fmt.duration));

    // Metadata tags (case-insensitive)
    const tagMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(tags)) {
      tagMap[k.toLowerCase()] = String(v);
    }

    if (tagMap.title) title = tagMap.title;
    if (tagMap.artist) artist = tagMap.artist;
    else if (tagMap.album_artist) artist = tagMap.album_artist;
    if (tagMap.album) album = tagMap.album;
    if (tagMap.genre) genre = tagMap.genre;
  } catch {
    // ffprobe failed — fall back to filename parsing
  }

  // Filename fallback: "Artist - Title" pattern
  if (artist === 'Unknown Artist' && filename.includes(' - ')) {
    const parts = filename.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  }

  // Directory fallback: parent dir = artist
  if (artist === 'Unknown Artist') {
    const parentDir = path.basename(path.dirname(filePath));
    if (parentDir && parentDir !== '.' && parentDir !== path.basename(scanDir)) {
      artist = parentDir;
    }
  }

  return { title, artist, album, duration_sec, genre, filePath };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n[scan] Scanning ${scanDir}${recursive ? ' (recursive)' : ' (top-level only)'}…`);
  const files = walkDir(scanDir, recursive);
  console.log(`[scan] Found ${files.length} audio files`);

  if (files.length === 0) {
    console.log('[scan] Nothing to import.');
    await pool.end();
    return;
  }

  // Resolve station
  let stationId = stationArg;
  let companyId = '';
  let categoryId = '';

  if (!dryRun) {
    if (!stationArg) {
      console.error('[scan] --station is required (use station ID or slug)');
      await pool.end();
      process.exit(1);
    }

    // Try UUID first, then slug
    const isUuid = /^[0-9a-f]{8}-/.test(stationArg);
    const stationQuery = isUuid
      ? `SELECT id, company_id FROM stations WHERE id = $1`
      : `SELECT id, company_id FROM stations WHERE slug = $1`;
    const { rows: stRows } = await pool.query<{ id: string; company_id: string }>(stationQuery, [stationArg]);
    if (!stRows[0]) {
      console.error(`[scan] Station not found: ${stationArg}`);
      await pool.end();
      process.exit(1);
    }
    stationId = stRows[0].id;
    companyId = stRows[0].company_id;

    // Get or create default category
    const { rows: catRows } = await pool.query<{ id: string }>(
      `SELECT id FROM categories WHERE station_id = $1 ORDER BY created_at LIMIT 1`,
      [stationId],
    );
    if (catRows[0]) {
      categoryId = catRows[0].id;
    } else {
      const { rows: newCat } = await pool.query<{ id: string }>(
        `INSERT INTO categories (station_id, code, label, rotation_weight)
         VALUES ($1, 'GEN', 'General', 1.0)
         ON CONFLICT (station_id, code) DO UPDATE SET label = EXCLUDED.label
         RETURNING id`,
        [stationId],
      );
      categoryId = newCat[0].id;
    }
  }

  // Extract metadata for all files
  console.log('[scan] Extracting metadata…');
  const songs: SongMeta[] = [];
  for (let i = 0; i < files.length; i++) {
    const meta = await extractMetadata(files[i].path);
    songs.push(meta);
    if ((i + 1) % 50 === 0) console.log(`  … ${i + 1}/${files.length}`);
  }

  if (dryRun) {
    console.log(`\n[scan] DRY RUN — ${songs.length} songs found:`);
    for (const s of songs.slice(0, 30)) {
      console.log(`  ${s.artist} — ${s.title} (${s.duration_sec ?? '?'}s) [${path.basename(s.filePath)}]`);
    }
    if (songs.length > 30) console.log(`  … and ${songs.length - 30} more`);
    await pool.end();
    return;
  }

  // Import songs
  console.log(`\n[scan] Importing to station ${stationId}…`);
  let imported = 0;
  let skipped = 0;

  for (const song of songs) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO songs (company_id, station_id, category_id, title, artist, duration_sec, audio_url, audio_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'local')
       ON CONFLICT (station_id, title, artist) DO NOTHING
       RETURNING id`,
      [companyId, stationId, categoryId, song.title, song.artist, song.duration_sec, song.filePath],
    );
    if (rows[0]) {
      imported++;
    } else {
      skipped++;
    }
  }

  console.log(`[scan] Imported: ${imported} new songs (${skipped} already existed)`);

  // Transcode if requested
  if (doTranscode && imported > 0) {
    console.log(`\n[scan] Transcoding ${imported} songs to HLS + uploading to R2…`);
    console.log('[scan] (This may take a while — each song takes ~10-30 seconds)');

    const { rows: toTranscode } = await pool.query<{
      id: string; title: string; artist: string; audio_url: string;
    }>(
      `SELECT id, title, artist, audio_url FROM songs
       WHERE station_id = $1 AND audio_source = 'local'
         AND audio_url NOT LIKE 'https://%'
       ORDER BY title`,
      [stationId],
    );

    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: process.env.S3_REGION ?? 'auto',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: false,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });
    const bucket = process.env.S3_BUCKET ?? '';
    const publicBase = (process.env.S3_PUBLIC_URL_BASE ?? '').replace(/\/$/, '');

    function slugify(text: string): string {
      return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[-\s]+/g, '-') || 'unknown';
    }

    const contentTypes: Record<string, string> = {
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.mp4': 'video/mp4',
      '.m4s': 'video/iso.segment',
    };

    let transcoded = 0;
    for (const song of toTranscode) {
      const localPath = song.audio_url;
      if (!fs.existsSync(localPath)) {
        console.warn(`  ⚠ File not found: ${localPath}`);
        continue;
      }

      const key = `audio/songs/${slugify(song.artist)}/${slugify(song.title)}`;
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'scan-hls-'));

      try {
        // Transcode to HLS
        await execFileAsync('ffmpeg', [
          '-i', localPath,
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          '-f', 'hls', '-hls_time', '6',
          '-hls_segment_type', 'fmp4',
          '-hls_fmp4_init_filename', 'init.mp4',
          '-hls_segment_filename', path.join(tmpDir, 'seg-%03d.m4s'),
          '-hls_playlist_type', 'vod',
          '-y', path.join(tmpDir, 'playlist.m3u8'),
        ], { timeout: 120000 });

        // Upload all files to R2
        for (const name of fs.readdirSync(tmpDir)) {
          const fpath = path.join(tmpDir, name);
          const ext = path.extname(name).toLowerCase();
          const ct = contentTypes[ext] ?? 'application/octet-stream';
          await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: `${key}/${name}`,
            Body: fs.readFileSync(fpath),
            ContentType: ct,
          }));
        }

        // Update song audio_url to CDN HLS playlist
        const cdnUrl = `${publicBase}/${key}/playlist.m3u8`;
        await pool.query(
          `UPDATE songs SET audio_url = $1, audio_source = 'local', updated_at = NOW() WHERE id = $2`,
          [cdnUrl, song.id],
        );

        transcoded++;
        if (transcoded % 10 === 0) console.log(`  … ${transcoded}/${toTranscode.length} transcoded`);
      } catch (err) {
        console.warn(`  ⚠ Transcode failed for ${song.title}: ${err instanceof Error ? err.message : err}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    console.log(`[scan] Transcoded: ${transcoded}/${toTranscode.length} songs uploaded to R2`);
  }

  console.log('\n[scan] Done!');
  await pool.end();
}

main().catch((err) => {
  console.error('[scan] Fatal:', err);
  process.exit(1);
});
