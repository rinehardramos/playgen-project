export interface StorageAdapter {
  write(path: string, data: Buffer | Uint8Array): Promise<void>;
  read(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  getPublicUrl(path: string): string;
}
