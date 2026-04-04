import { config } from '../../config.js';
import type { StorageAdapter } from './interface.js';
import { LocalStorageAdapter } from './localStorage.js';

let adapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (!adapter) {
    if (config.storage.provider === 'local') {
      adapter = new LocalStorageAdapter();
    } else if (config.storage.provider === 's3') {
      // S3Adapter will be implemented in Phase 5
      throw new Error('S3 storage provider not yet implemented');
    } else {
      throw new Error(`Unknown storage provider: ${config.storage.provider}`);
    }
  }
  return adapter;
}

export * from './interface.js';
