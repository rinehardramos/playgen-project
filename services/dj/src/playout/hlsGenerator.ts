import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { ProgramManifest } from '../services/manifestService.js';
import { getStorageAdapter } from '../lib/storage/index.js';

const execFileAsync = promisify(execFile);

const HLS_OUTPUT_DIR = process.env.HLS_OUTPUT_PATH || path.join(process.cwd(), 'data', 'hls');
const TARGET_DURATION = 10; // seconds per HLS segment

export interface HlsState {
  stationId: string;
  playlistPath: string;   // path to the live .m3u8 file
  segmentDir: string;     // directory containing .ts segments
  totalSegments: number;
}

/**
 * Generate HLS segments from a program manifest.
 *
 * For each audio file in the manifest, transcodes to MPEG-TS segments
 * and builds a live-style M3U8 playlist.
 */
export async function generateHls(stationId: string, manifest: ProgramManifest): Promise<HlsState> {
  const stationDir = path.join(HLS_OUTPUT_DIR, stationId);
  fs.mkdirSync(stationDir, { recursive: true });

  const playlistPath = path.join(stationDir, 'playlist.m3u8');
  const segmentDir = stationDir;

  // Build a concat list for ffmpeg
  const concatListPath = path.join(stationDir, 'concat.txt');
  const storage = getStorageAdapter();
  const lines: string[] = [];

  for (const seg of manifest.segments) {
    if (!seg.audio_url) continue;
    // Resolve audio URL to a local file path
    const localPath = await resolveAudioPath(seg.audio_url, storage);
    if (localPath && fs.existsSync(localPath)) {
      lines.push(`file '${localPath.replace(/'/g, "'\\''")}'`);
    }
  }

  if (lines.length === 0) {
    throw new Error('No audio files found in manifest');
  }

  await fs.promises.writeFile(concatListPath, lines.join('\n'));

  // Transcode all audio into HLS
  const segmentPattern = path.join(segmentDir, 'segment-%05d.ts');
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    '-f', 'hls',
    '-hls_time', String(TARGET_DURATION),
    '-hls_list_size', '0',       // Keep all segments in playlist
    '-hls_segment_filename', segmentPattern,
    '-hls_playlist_type', 'vod', // Full playlist (not live windowed)
    playlistPath,
  ], { timeout: 600_000 }); // 10 min timeout for long programs

  // Count generated segments
  const files = await fs.promises.readdir(segmentDir);
  const totalSegments = files.filter(f => f.endsWith('.ts')).length;

  // Clean up concat list
  fs.promises.unlink(concatListPath).catch(() => {});

  return { stationId, playlistPath, segmentDir, totalSegments };
}

/**
 * Generate a live-style sliding window M3U8 for a specific position.
 * Returns a playlist with only the current and next few segments.
 */
export function generateLivePlaylist(
  stationId: string,
  currentSegmentTsIndex: number,
  totalSegments: number,
  windowSize = 3,
): string {
  const startIdx = Math.max(0, currentSegmentTsIndex);
  const endIdx = Math.min(totalSegments, startIdx + windowSize);

  const lines = [
    '#EXTM3U',
    `#EXT-X-VERSION:3`,
    `#EXT-X-TARGETDURATION:${TARGET_DURATION}`,
    `#EXT-X-MEDIA-SEQUENCE:${startIdx}`,
  ];

  for (let i = startIdx; i < endIdx; i++) {
    lines.push(`#EXTINF:${TARGET_DURATION},`);
    lines.push(`segment-${String(i).padStart(5, '0')}.ts`);
  }

  if (endIdx >= totalSegments) {
    lines.push('#EXT-X-ENDLIST');
  }

  return lines.join('\n');
}

/** Resolve an audio_url to a local filesystem path. */
async function resolveAudioPath(
  audioUrl: string,
  storage: ReturnType<typeof getStorageAdapter>,
): Promise<string | null> {
  // If it's already an absolute path on disk
  if (path.isAbsolute(audioUrl) && fs.existsSync(audioUrl)) {
    return audioUrl;
  }

  const cacheKey = audioUrl.replace(/[/\\:?=&]/g, '_').replace(/^https?__/, '');
  const tmpPath = path.join(HLS_OUTPUT_DIR, '.cache', cacheKey);
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });

  // If already cached locally, reuse it
  if (fs.existsSync(tmpPath)) return tmpPath;

  try {
    let buffer: Buffer;
    if (audioUrl.startsWith('http')) {
      // Full public URL — download via HTTP
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${audioUrl}`);
      buffer = Buffer.from(await res.arrayBuffer());
    } else {
      // Relative storage key — read via adapter
      buffer = await storage.read(audioUrl);
    }
    await fs.promises.writeFile(tmpPath, buffer);
    return tmpPath;
  } catch {
    return null;
  }
}

/** Clean up HLS files for a station. */
export async function cleanupHls(stationId: string): Promise<void> {
  const stationDir = path.join(HLS_OUTPUT_DIR, stationId);
  await fs.promises.rm(stationDir, { recursive: true, force: true });
}
