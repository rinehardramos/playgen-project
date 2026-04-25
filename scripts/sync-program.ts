#!/usr/bin/env tsx
/**
 * sync-program.ts
 *
 * Reads a locally-generated radio program from the local PlayGen DB, uploads
 * all segment audio files to R2 (S3-compatible), then POSTs the full program
 * bundle to the production ingest endpoint.
 *
 * Usage:
 *   pnpm tsx scripts/sync-program.ts <script_id> [options]
 *
 * Options:
 *   --station-slug   Slug to register on production (default: derived from station name)
 *   --prod-gateway   Production gateway URL (default: $PROD_GATEWAY_URL || https://api.playgen.site)
 *   --prod-token     Production JWT access token (default: $PROD_ACCESS_TOKEN)
 *   --dry-run        Skip R2 upload and production POST; print payload to stdout
 *
 * Required env vars (read from .env or environment):
 *   DATABASE_URL          Local PG connection string
 *   STORAGE_LOCAL_PATH    Where local audio files are stored (default: /tmp/playgen-dj)
 *   S3_BUCKET             R2 bucket name
 *   S3_ENDPOINT           R2 endpoint URL  (e.g. https://xxx.r2.cloudflarestorage.com)
 *   S3_REGION             R2 region (usually auto or us-east-1)
 *   S3_PREFIX             Key prefix  (default: dj-audio)
 *   S3_PUBLIC_URL_BASE    Public CDN URL for uploaded files
 *   AWS_ACCESS_KEY_ID     R2 API token key
 *   AWS_SECRET_ACCESS_KEY R2 API token secret
 *   PROD_GATEWAY_URL      Production gateway (can also pass as --prod-gateway)
 *   PROD_ACCESS_TOKEN     Production JWT (can also pass as --prod-token)
 */

import path from 'path';
import fs from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';

// ── Load .env (project root) ──────────────────────────────────────────────
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

// ── Parse CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const script_id = args[0];
if (!script_id) {
  console.error('Usage: pnpm tsx scripts/sync-program.ts <script_id> [--dry-run] [--prod-gateway <url>] [--prod-token <jwt>]');
  process.exit(1);
}

const dryRun = args.includes('--dry-run');
const gwIdx = args.indexOf('--prod-gateway');
const tkIdx = args.indexOf('--prod-token');
const slIdx = args.indexOf('--station-slug');

const prodGateway = (gwIdx !== -1 ? args[gwIdx + 1] : null) ?? process.env.PROD_GATEWAY_URL ?? 'https://api.playgen.site';
const prodToken = (tkIdx !== -1 ? args[tkIdx + 1] : null) ?? process.env.PROD_ACCESS_TOKEN ?? '';
const overrideSlug = slIdx !== -1 ? args[slIdx + 1] : null;

if (!prodToken && !dryRun) {
  console.error('Error: PROD_ACCESS_TOKEN env var or --prod-token flag is required');
  process.exit(1);
}

// ── DB + Storage setup ────────────────────────────────────────────────────
const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'playgen',
      user: process.env.POSTGRES_USER ?? 'playgen',
      password: process.env.POSTGRES_PASSWORD,
    };
const pool = new pg.Pool(poolConfig);
const localStoragePath = process.env.STORAGE_LOCAL_PATH ?? '/tmp/playgen-dj';

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: !!process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
});
const s3Bucket = process.env.S3_BUCKET ?? '';
const s3Prefix = process.env.S3_PREFIX ?? 'dj-audio';
const s3PublicBase = (process.env.S3_PUBLIC_URL_BASE ?? '').replace(/\/$/, '');

async function uploadToR2(localRelPath: string): Promise<string> {
  const localAbs = path.join(localStoragePath, localRelPath);
  if (!fs.existsSync(localAbs)) throw new Error(`Audio file not found: ${localAbs}`);
  const buf = fs.readFileSync(localAbs);
  const s3Key = s3Prefix ? `${s3Prefix}/${localRelPath}` : localRelPath;
  await s3.send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: s3Key,
    Body: buf,
    ContentType: 'audio/mpeg',
  }));
  const publicUrl = s3PublicBase
    ? `${s3PublicBase}/${s3Key}`
    : `https://${s3Bucket}.s3.${process.env.S3_REGION ?? 'us-east-1'}.amazonaws.com/${s3Key}`;
  console.log(`  ✓ uploaded ${localRelPath} → ${publicUrl}`);
  return publicUrl;
}

async function main() {
  // ── 1. Fetch script + station + profile from local DB ──────────────
  console.log(`\n[sync-program] Fetching script ${script_id} from local DB…`);

  const { rows: scriptRows } = await pool.query<{
    id: string; playlist_id: string; station_id: string; dj_profile_id: string;
    review_status: string; llm_model: string; generation_source: string;
  }>(`SELECT * FROM dj_scripts WHERE id = $1`, [script_id]);

  const script = scriptRows[0];
  if (!script) { console.error('Script not found in local DB'); process.exit(1); }

  const { rows: stRows } = await pool.query<{
    id: string; name: string; slug: string | null; timezone: string; locale_code: string | null;
    city: string | null; country_code: string | null;
    callsign: string | null; tagline: string | null; frequency: string | null;
  }>(`SELECT id, name, slug, timezone, locale_code, city, country_code, callsign, tagline, frequency
      FROM stations WHERE id = $1`, [script.station_id]);
  const station = stRows[0];
  if (!station) { console.error('Station not found'); process.exit(1); }

  const slug = overrideSlug ?? station.slug ?? station.name.toLowerCase().replace(/\s+/g, '-');

  const { rows: profRows } = await pool.query<{
    id: string; name: string; personality: string; voice_style: string;
    persona_config: Record<string, unknown>; llm_model: string; tts_provider: string; tts_voice_id: string;
  }>(`SELECT id, name, personality, voice_style, persona_config, llm_model, tts_provider, tts_voice_id
      FROM dj_profiles WHERE id = $1`, [script.dj_profile_id]);
  const profile = profRows[0];
  if (!profile) { console.error('DJ profile not found'); process.exit(1); }

  const { rows: plRows } = await pool.query<{ id: string; date: string }>(
    `SELECT id, date FROM playlists WHERE id = $1`, [script.playlist_id]);
  const playlist = plRows[0];
  if (!playlist) { console.error('Playlist not found'); process.exit(1); }

  const { rows: entries } = await pool.query<{
    id: string; hour: number; position: number;
    song_title: string; song_artist: string; duration_sec: number | null;
  }>(
    `SELECT pe.id, pe.hour, pe.position,
            s.title AS song_title, s.artist AS song_artist, s.duration_sec
     FROM playlist_entries pe
     JOIN songs s ON s.id = pe.song_id
     WHERE pe.playlist_id = $1
     ORDER BY pe.hour, pe.position`, [playlist.id]);

  const { rows: segments } = await pool.query<{
    id: string; segment_type: string; position: number; script_text: string;
    playlist_entry_id: string | null; audio_url: string | null; audio_duration_sec: number | null;
  }>(
    `SELECT id, segment_type, position, script_text, playlist_entry_id,
            audio_url, audio_duration_sec
     FROM dj_segments WHERE script_id = $1 ORDER BY position`, [script_id]);

  console.log(`  Station: ${station.name} (${slug})`);
  console.log(`  DJ Profile: ${profile.name}`);
  console.log(`  Playlist date: ${playlist.date}`);
  console.log(`  Tracks: ${entries.length}, Segments: ${segments.length}`);

  // Build entry ID → index map for playlist_entry_ref
  const entryIndexMap = new Map(entries.map((e, i) => [e.id, i]));

  // ── 2. Upload audio files to R2 ────────────────────────────────────
  const segmentPayload: Array<{
    segment_type: string; position: number; script_text: string;
    playlist_entry_ref: number | null; audio_url: string | null; audio_duration_sec: number | null;
  }> = [];

  console.log('\n[sync-program] Uploading audio to R2…');
  for (const seg of segments) {
    let audioUrl = seg.audio_url;

    if (!dryRun && seg.audio_url) {
      if (seg.audio_url.startsWith('http')) {
        // Already a CDN URL — skip re-upload
        console.log(`  ✓ already on CDN: ${seg.audio_url.substring(0, 80)}…`);
      } else {
        // Extract relative path from /api/v1/dj/audio/<rel>
        const prefix = '/api/v1/dj/audio/';
        const relPath = seg.audio_url.startsWith(prefix)
          ? seg.audio_url.substring(prefix.length)
          : seg.audio_url;
        try {
          audioUrl = await uploadToR2(relPath);
        } catch (err) {
          console.warn(`  ⚠ Could not upload ${relPath}: ${err instanceof Error ? err.message : err}`);
          audioUrl = null;
        }
      }
    }

    segmentPayload.push({
      segment_type: seg.segment_type,
      position: seg.position,
      script_text: seg.script_text,
      playlist_entry_ref: seg.playlist_entry_id != null ? (entryIndexMap.get(seg.playlist_entry_id) ?? null) : null,
      audio_url: audioUrl,
      audio_duration_sec: seg.audio_duration_sec,
    });
  }

  // ── 3. Build sync payload ──────────────────────────────────────────
  const payload = {
    station: {
      slug,
      name: station.name,
      timezone: station.timezone,
      locale_code: station.locale_code,
      city: station.city,
      country_code: station.country_code,
      callsign: station.callsign,
      tagline: station.tagline,
      frequency: station.frequency,
    },
    dj_profile: {
      name: profile.name,
      personality: profile.personality,
      voice_style: profile.voice_style,
      persona_config: profile.persona_config,
      llm_model: profile.llm_model,
      tts_provider: profile.tts_provider,
      tts_voice_id: profile.tts_voice_id,
    },
    playlist: {
      date: playlist.date,
      entries: entries.map(e => ({
        hour: e.hour,
        position: e.position,
        song_title: e.song_title,
        song_artist: e.song_artist,
        duration_sec: e.duration_sec,
      })),
    },
    script: {
      generation_source: script.generation_source,
      llm_model: script.llm_model,
      review_status: script.review_status,
      segments: segmentPayload,
    },
    stream_url: null as string | null,
  };

  // ── 4. POST to production ingest endpoint ──────────────────────────
  if (dryRun) {
    console.log('\n[sync-program] DRY RUN — payload:');
    console.log(JSON.stringify(payload, null, 2));
    await pool.end();
    return;
  }

  console.log(`\n[sync-program] POSTing to ${prodGateway}/api/v1/stations/ingest-external…`);
  const res = await fetch(`${prodGateway}/api/v1/stations/ingest-external`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${prodToken}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    console.error(`\n[sync-program] Production ingest failed (${res.status}):`, body);
    await pool.end();
    process.exit(1);
  }

  console.log('\n[sync-program] ✅ Sync complete!');
  console.log(`  station_id:   ${body.station_id}`);
  console.log(`  script_id:    ${body.script_id}`);
  console.log(`  segments:     ${body.segment_count}`);
  console.log(`  slug:         ${body.slug}`);
  console.log(`  OwnRadio:     ${body.ownradio_notified ? 'notified ✓' : 'skipped (no stream_url)'}`);
  console.log(`\n  🔗 playgen.site → Station: ${prodGateway.replace('/api', '')}/stations/${body.station_id}`);

  await pool.end();
}

main().catch((err) => {
  console.error('[sync-program] Fatal:', err);
  process.exit(1);
});
