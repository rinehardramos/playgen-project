import { initStorage, getStorageAdapter } from '@playgen/storage';
import { config } from '../../config.js';

// Initialize on first import
initStorage({
  provider: config.storage.provider as 'local' | 's3',
  localPath: config.storage.localPath,
  s3Bucket: config.storage.s3Bucket,
  s3Region: config.storage.s3Region,
  s3Prefix: config.storage.s3Prefix,
  s3Endpoint: config.storage.s3Endpoint,
  s3PublicUrlBase: config.storage.s3PublicUrlBase,
  awsAccessKeyId: config.storage.awsAccessKeyId,
  awsSecretAccessKey: config.storage.awsSecretAccessKey,
});

export { getStorageAdapter };
export type { StorageAdapter } from '@playgen/storage';
