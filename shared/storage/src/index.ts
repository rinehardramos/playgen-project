import { LocalStorageAdapter } from './localStorage.js';
import { S3StorageAdapter } from './s3Storage.js';
import type { StorageAdapter, StorageConfig } from './interface.js';

export type { StorageAdapter, StorageConfig } from './interface.js';
export { LocalStorageAdapter } from './localStorage.js';
export { S3StorageAdapter } from './s3Storage.js';

let _adapter: StorageAdapter | null = null;

export function initStorage(config: StorageConfig): StorageAdapter {
  if (config.provider === 's3') {
    _adapter = new S3StorageAdapter(config);
  } else {
    _adapter = new LocalStorageAdapter(config.localPath);
  }
  return _adapter;
}

export function getStorageAdapter(): StorageAdapter {
  if (!_adapter) throw new Error('Storage not initialized. Call initStorage() first.');
  return _adapter;
}
