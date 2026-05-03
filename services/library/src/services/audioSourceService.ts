import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getPool } from '../db';
import { storeAudioFile } from './audioStorageService';

const execFileAsync = promisify(execFile);

const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

/**
 * Build yt-dlp args that bypass YouTube bot-detection on cloud/Railway IPs.
 * iOS/Android player clients use YouTube's mobile API and are not subject to
 * the bot-check pipeline that blocks requests from cloud server IPs.
 * Exported for unit testing.
 */
export function buildYtDlpBotArgs(): string[] {
  const args: string[] = ['--extractor-args', 'youtube:player_client=ios,android'];
  const cookiesFile = process.env.YT_DLP_COOKIES_FILE;
  if (cookiesFile) {
    args.push('--cookies', cookiesFile);
  }
  return args;
}

interface SourceResult {
  songId: string;
  audioUrl: string;
  durationSec: number | null;
  source: string;
}

/**
 * Download audio for a single song from YouTube via yt-dlp.
 * Searches by "{artist} - {title}" and downloads the best audio.
 */
export async function sourceFromYouTube(
  songId: string,
  stationId: string,
  title: string,
  artist: string,
): Promise<SourceResult> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'playgen-ytdl-'));
  const outputTemplate = path.join(tmpDir, '%(id)s.%(ext)s');
  const searchQuery = `${artist} - ${title}`;

  try {
    await execFileAsync(YT_DLP, [
      `ytsearch1:${searchQuery}`,
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '192K',
      '--no-playlist',
      '--max-downloads', '1',
      '--output', outputTemplate,
      '--no-warnings',
      '--quiet',
      ...buildYtDlpBotArgs(),
    ], { timeout: 120_000 });

    // Find the downloaded file
    const files = await fs.promises.readdir(tmpDir);
    const audioFile = files.find(f => f.endsWith('.mp3') || f.endsWith('.opus') || f.endsWith('.m4a'));
    if (!audioFile) throw new Error(`yt-dlp produced no audio file for "${searchQuery}"`);

    const sourcePath = path.join(tmpDir, audioFile);
    const { audioUrl, durationSec } = await storeAudioFile(stationId, songId, sourcePath);

    // Update database
    await getPool().query(
      `UPDATE songs SET audio_url = $1, audio_source = 'youtube', duration_sec = COALESCE($2, duration_sec), updated_at = NOW() WHERE id = $3`,
      [audioUrl, durationSec, songId],
    );

    return { songId, audioUrl, durationSec, source: 'youtube' };
  } finally {
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Bulk-source audio for all songs in a station that are missing audio_url.
 * Processes sequentially to avoid rate-limiting.
 */
export async function bulkSourceFromYouTube(
  stationId: string,
  opts: { limit?: number } = {},
): Promise<{ sourced: number; failed: number; errors: Array<{ songId: string; error: string }> }> {
  const limit = opts.limit ?? 50;
  const { rows } = await getPool().query<{ id: string; title: string; artist: string }>(
    `SELECT id, title, artist FROM songs
     WHERE station_id = $1 AND is_active = TRUE AND audio_url IS NULL
     ORDER BY artist, title
     LIMIT $2`,
    [stationId, limit],
  );

  let sourced = 0;
  let failed = 0;
  const errors: Array<{ songId: string; error: string }> = [];

  for (const song of rows) {
    try {
      await sourceFromYouTube(song.id, stationId, song.title, song.artist);
      sourced++;
    } catch (err) {
      failed++;
      errors.push({ songId: song.id, error: (err as Error).message });
    }
  }

  return { sourced, failed, errors };
}

/**
 * Scan a local directory for audio files and match them to songs by filename.
 * Expected filename pattern: "{artist} - {title}.mp3"
 */
export async function bulkImportFromDirectory(
  stationId: string,
  dirPath: string,
): Promise<{ matched: number; unmatched: string[] }> {
  const entries = await fs.promises.readdir(dirPath);
  const audioExts = new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.opus']);

  let matched = 0;
  const unmatched: string[] = [];

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!audioExts.has(ext)) continue;

    const basename = path.basename(entry, ext);
    const sepIdx = basename.indexOf(' - ');
    if (sepIdx === -1) { unmatched.push(entry); continue; }

    const artist = basename.slice(0, sepIdx).trim();
    const title = basename.slice(sepIdx + 3).trim();

    // Find matching song (case-insensitive)
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM songs
       WHERE station_id = $1 AND LOWER(artist) = LOWER($2) AND LOWER(title) = LOWER($3)
       LIMIT 1`,
      [stationId, artist, title],
    );

    if (!rows[0]) { unmatched.push(entry); continue; }

    const sourcePath = path.join(dirPath, entry);
    const { audioUrl, durationSec } = await storeAudioFile(stationId, rows[0].id, sourcePath);

    await getPool().query(
      `UPDATE songs SET audio_url = $1, audio_source = 'upload', duration_sec = COALESCE($2, duration_sec), updated_at = NOW() WHERE id = $3`,
      [audioUrl, durationSec, rows[0].id],
    );

    matched++;
  }

  return { matched, unmatched };
}
