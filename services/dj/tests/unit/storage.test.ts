import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { LocalStorageAdapter } from '../../src/lib/storage/localStorage';

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('test')),
    access: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('LocalStorageAdapter', () => {
  const baseDir = '/tmp/test-storage';
  const adapter = new LocalStorageAdapter(baseDir);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes data to correct path', async () => {
    const filePath = 'test.mp3';
    const data = Buffer.from('audio');
    await adapter.write(filePath, data);

    expect(fs.mkdir).toHaveBeenCalledWith(baseDir, { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(baseDir, filePath), data);
  });

  it('reads data from correct path', async () => {
    const filePath = 'test.mp3';
    const data = await adapter.read(filePath);

    expect(data.toString()).toBe('test');
    expect(fs.readFile).toHaveBeenCalledWith(path.join(baseDir, filePath));
  });

  it('checks if file exists', async () => {
    const filePath = 'test.mp3';
    const exists = await adapter.exists(filePath);

    expect(exists).toBe(true);
    expect(fs.access).toHaveBeenCalledWith(path.join(baseDir, filePath));
  });

  it('returns false if file does not exist', async () => {
    (fs.access as any).mockRejectedValueOnce(new Error('ENOENT'));
    const exists = await adapter.exists('missing.mp3');
    expect(exists).toBe(false);
  });

  it('deletes file', async () => {
    const filePath = 'test.mp3';
    await adapter.delete(filePath);
    expect(fs.unlink).toHaveBeenCalledWith(path.join(baseDir, filePath));
  });

  it('generates public URL', () => {
    const filePath = 'some/path/file.mp3';
    const url = adapter.getPublicUrl(filePath);
    expect(url).toBe(`/api/v1/dj/audio/${filePath}`);
  });
});
