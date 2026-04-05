import { config } from '../../config.js';
import type { StorageAdapter } from './interface.js';
import { LocalStorageAdapter } from './localStorage.js';
import { S3StorageAdapter } from './s3Storage.js';

let adapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (!adapter) {
    if (config.storage.provider === 'local') {
      adapter = new LocalStorageAdapter();
    } else if (config.storage.provider === 's3') {
      adapter = new S3StorageAdapter();
    } else {
      throw new Error(`Unknown storage provider: ${config.storage.provider}`);
    }
  }
  return adapter;
}

export * from './interface.js';
