import fs from 'fs/promises';
import path from 'path';
import type { StorageAdapter } from './interface.js';

export class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir: string = '/tmp/playgen-audio') {
    this.baseDir = baseDir;
  }

  async write(filePath: string, data: Buffer | Uint8Array): Promise<void> {
    const fullPath = path.join(this.baseDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
  }

  async read(filePath: string): Promise<Buffer> {
    const fullPath = path.join(this.baseDir, filePath);
    return fs.readFile(fullPath);
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.baseDir, filePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = path.join(this.baseDir, filePath);
    try {
      await fs.unlink(fullPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  getPublicUrl(filePath: string): string {
    // Standardized public URL prefix for the gateway
    return `/api/v1/dj/audio/${filePath}`;
  }
}
