import { getStorageAdapter, S3StorageAdapter } from '@playgen/storage';

/**
 * Get a presigned PUT URL for direct client → R2/B2/S3 upload.
 * Returns null when STORAGE_PROVIDER=local (caller should use upload-audio multipart endpoint).
 */
export async function getPresignedPutUrl(
  key: string,
  contentType = 'audio/mpeg',
): Promise<string | null> {
  let adapter: ReturnType<typeof getStorageAdapter>;
  try {
    adapter = getStorageAdapter();
  } catch {
    return null;
  }
  if (!(adapter instanceof S3StorageAdapter)) return null;
  return adapter.getPresignedPutUrl(key, contentType);
}

/**
 * Build the canonical storage key for a song audio file.
 */
export function songAudioKey(stationId: string, songId: string, ext = '.mp3'): string {
  return `songs/${stationId}/${songId}${ext}`;
}
