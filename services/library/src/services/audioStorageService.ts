import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const AUDIO_BASE_DIR = process.env.AUDIO_STORAGE_PATH || path.join(process.cwd(), 'data', 'audio', 'songs');

/** Ensure the storage directory for a station exists. */
function stationDir(stationId: string): string {
  const dir = path.join(AUDIO_BASE_DIR, stationId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Store an audio file for a song. Returns the relative storage path. */
export async function storeAudioFile(
  stationId: string,
  songId: string,
  sourcePath: string,
): Promise<{ audioUrl: string; durationSec: number | null }> {
  const ext = path.extname(sourcePath) || '.mp3';
  const destFilename = `${songId}${ext}`;
  const destPath = path.join(stationDir(stationId), destFilename);

  await fs.promises.copyFile(sourcePath, destPath);

  const durationSec = await probeDuration(destPath);
  const audioUrl = path.relative(AUDIO_BASE_DIR, destPath);
  return { audioUrl, durationSec };
}

/** Store audio from a readable stream (multipart upload). */
export async function storeAudioStream(
  stationId: string,
  songId: string,
  stream: NodeJS.ReadableStream,
  ext: string,
): Promise<{ audioUrl: string; durationSec: number | null }> {
  const destFilename = `${songId}${ext}`;
  const destPath = path.join(stationDir(stationId), destFilename);

  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    stream.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
  });

  const durationSec = await probeDuration(destPath);
  const audioUrl = path.relative(AUDIO_BASE_DIR, destPath);
  return { audioUrl, durationSec };
}

/** Get the full filesystem path for an audio URL. */
export function resolveAudioPath(audioUrl: string): string {
  return path.join(AUDIO_BASE_DIR, audioUrl);
}

/** Probe audio duration using ffprobe. Returns seconds or null if ffprobe unavailable. */
export async function probeDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ]);
    const info = JSON.parse(stdout);
    const dur = parseFloat(info.format?.duration);
    return Number.isFinite(dur) ? Math.round(dur) : null;
  } catch {
    return null;
  }
}
