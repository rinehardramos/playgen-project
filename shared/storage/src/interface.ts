export interface StorageAdapter {
  write(path: string, data: Buffer | Uint8Array): Promise<void>;
  read(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  getPublicUrl(path: string): string;
}

export interface StorageConfig {
  provider: 'local' | 's3';
  localPath?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Prefix?: string;
  s3Endpoint?: string;
  s3PublicUrlBase?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}
