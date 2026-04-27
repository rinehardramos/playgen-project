import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getPool } from '../db';

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────────

export interface AudioFile {
  path: string;
  filename: string;
  ext: string;
}

export interface SongMeta {
  title: string;
  artist: string;
  album: string | null;
  duration_sec: number | null;
  genre: string | null;
  filePath: string;
}

export interface ScanResult {
  status: 'completed' | 'failed';
  started_at: string;
  finished_at: string;
  directory: string;
  recursive: boolean;
  files_found: number;
  imported: number;
  skipped: number;
  errors: number;
  error_message?: string;
}

export interface ScanStatus {
  scanning: boolean;
  station_id: string;
  progress?: { current: number; total: number };
  last_result?: ScanResult;
}

// In-memory active scan tracker (single-process, no Redis needed)
const activeScans = new Map<string, { current: number; total: number }>();

export function isScanning(stationId: string): boolean {
  return activeScans.has(stationId);
}

export function getScanProgress(stationId: string): { current: number; total: number } | undefined {
  return activeScans.get(stationId);
}

// ── File Discovery ───────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'aac', 'wma'];

export function walkDir(dir: string, recurse = true, extensions = DEFAULT_EXTENSIONS): AudioFile[] {
  const files: AudioFile[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && recurse) {
        files.push(...walkDir(fullPath, true, extensions));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (extensions.includes(ext)) {
          files.push({ path: fullPath, filename: entry.name, ext });
        }
      }
    }
  } catch (err) {
    console.warn(`[scanner] Cannot read ${dir}: ${err instanceof Error ? err.message : err}`);
  }
  return files;
}

// ── Metadata Extraction ──────────────────────────────────────────────────────

export async function extractMetadata(filePath: string, scanDir: string): Promise<SongMeta> {
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

    if (fmt.duration) duration_sec = Math.round(parseFloat(fmt.duration));

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

// ── Main Scan ────────────────────────────────────────────────────────────────

export interface ScanOptions {
  stationId: string;
  companyId: string;
  dir: string;
  recursive?: boolean;
  extensions?: string[];
  transcode?: boolean;
}

export async function runScan(opts: ScanOptions): Promise<ScanResult> {
  const { stationId, companyId, dir, recursive = true, extensions = DEFAULT_EXTENSIONS } = opts;
  const startedAt = new Date().toISOString();

  // Validate directory
  if (!dir || !fs.existsSync(dir)) {
    return {
      status: 'failed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      directory: dir,
      recursive,
      files_found: 0,
      imported: 0,
      skipped: 0,
      errors: 0,
      error_message: `Directory not found: ${dir}`,
    };
  }

  const pool = getPool();
  activeScans.set(stationId, { current: 0, total: 0 });

  try {
    // Discover files
    const files = walkDir(dir, recursive, extensions);
    activeScans.set(stationId, { current: 0, total: files.length });

    if (files.length === 0) {
      return {
        status: 'completed',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        directory: dir,
        recursive,
        files_found: 0,
        imported: 0,
        skipped: 0,
        errors: 0,
      };
    }

    // Resolve default category
    let { rows: catRows } = await pool.query<{ id: string }>(
      `SELECT id FROM categories WHERE station_id = $1 ORDER BY created_at LIMIT 1`,
      [stationId],
    );
    if (!catRows[0]) {
      const { rows: newCat } = await pool.query<{ id: string }>(
        `INSERT INTO categories (station_id, code, label, rotation_weight)
         VALUES ($1, 'GEN', 'General', 1.0)
         ON CONFLICT (station_id, code) DO UPDATE SET label = EXCLUDED.label
         RETURNING id`,
        [stationId],
      );
      catRows = newCat;
    }
    const categoryId = catRows[0].id;

    // Extract metadata + import
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < files.length; i++) {
      try {
        const meta = await extractMetadata(files[i].path, dir);
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO songs (company_id, station_id, category_id, title, artist, duration_sec, audio_url, audio_source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'local')
           ON CONFLICT (station_id, title, artist) DO NOTHING
           RETURNING id`,
          [companyId, stationId, categoryId, meta.title, meta.artist, meta.duration_sec, meta.filePath],
        );
        if (rows[0]) imported++;
        else skipped++;
      } catch {
        errors++;
      }
      activeScans.set(stationId, { current: i + 1, total: files.length });
    }

    const result: ScanResult = {
      status: 'completed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      directory: dir,
      recursive,
      files_found: files.length,
      imported,
      skipped,
      errors,
    };

    // Persist result to station_settings
    await saveScanResult(stationId, result);

    return result;
  } catch (err) {
    const result: ScanResult = {
      status: 'failed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      directory: dir,
      recursive,
      files_found: 0,
      imported: 0,
      skipped: 0,
      errors: 1,
      error_message: err instanceof Error ? err.message : String(err),
    };
    await saveScanResult(stationId, result).catch(() => {});
    return result;
  } finally {
    activeScans.delete(stationId);
  }
}

async function saveScanResult(stationId: string, result: ScanResult): Promise<void> {
  await getPool().query(
    `INSERT INTO station_settings (station_id, key, value, is_secret)
     VALUES ($1, 'music_scan_last_result', $2, false)
     ON CONFLICT (station_id, key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
    [stationId, JSON.stringify(result)],
  );
}

export async function getLastScanResult(stationId: string): Promise<ScanResult | null> {
  const { rows } = await getPool().query<{ value: string }>(
    `SELECT value FROM station_settings WHERE station_id = $1 AND key = 'music_scan_last_result'`,
    [stationId],
  );
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].value) as ScanResult;
  } catch {
    return null;
  }
}
