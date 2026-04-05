import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock @aws-sdk/client-s3 before importing S3StorageAdapter ---

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = mockSend;
  }
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class HeadObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand };
});

// Mock config so the adapter can be constructed without real env vars
vi.mock('../../src/config.js', () => ({
  config: {
    storage: {
      s3Bucket: 'test-bucket',
      s3Region: 'us-east-1',
      s3Prefix: 'dj-audio',
      awsAccessKeyId: 'AKIATEST',
      awsSecretAccessKey: 'secret',
    },
  },
}));

import { S3StorageAdapter } from '../../src/lib/storage/s3Storage.js';

// Helper to create an async iterable from an array of Uint8Arrays
function makeAsyncIterable(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe('S3StorageAdapter', () => {
  const adapter = new S3StorageAdapter('test-bucket', 'us-east-1', 'dj-audio');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes data to the correct S3 key', async () => {
    mockSend.mockResolvedValueOnce({});
    const data = Buffer.from('audio');
    await adapter.write('scripts/abc/1.mp3', data);

    expect(mockSend).toHaveBeenCalledOnce();
    const command = mockSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'dj-audio/scripts/abc/1.mp3',
      Body: data,
      ContentType: 'audio/mpeg',
    });
  });

  it('reads data from S3 and returns a Buffer', async () => {
    const chunk = new Uint8Array(Buffer.from('hello'));
    mockSend.mockResolvedValueOnce({
      Body: makeAsyncIterable([chunk]),
    });

    const result = await adapter.read('scripts/abc/1.mp3');
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe('hello');

    const command = mockSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'dj-audio/scripts/abc/1.mp3',
    });
  });

  it('throws when S3 returns no Body', async () => {
    mockSend.mockResolvedValueOnce({ Body: null });
    await expect(adapter.read('missing.mp3')).rejects.toThrow(/empty/i);
  });

  it('returns true when object exists (HeadObject succeeds)', async () => {
    mockSend.mockResolvedValueOnce({});
    const exists = await adapter.exists('scripts/abc/1.mp3');
    expect(exists).toBe(true);
  });

  it('returns false when object does not exist (404)', async () => {
    const notFound = Object.assign(new Error('Not Found'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    mockSend.mockRejectedValueOnce(notFound);
    const exists = await adapter.exists('missing.mp3');
    expect(exists).toBe(false);
  });

  it('re-throws non-404 errors from exists()', async () => {
    const serviceError = Object.assign(new Error('Service Error'), {
      name: 'ServiceUnavailable',
      $metadata: { httpStatusCode: 503 },
    });
    mockSend.mockRejectedValueOnce(serviceError);
    await expect(adapter.exists('file.mp3')).rejects.toThrow('Service Error');
  });

  it('deletes the correct S3 key', async () => {
    mockSend.mockResolvedValueOnce({});
    await adapter.delete('scripts/abc/1.mp3');

    expect(mockSend).toHaveBeenCalledOnce();
    const command = mockSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'dj-audio/scripts/abc/1.mp3',
    });
  });

  it('generates the correct public URL', () => {
    const url = adapter.getPublicUrl('scripts/abc/1.mp3');
    expect(url).toBe(
      'https://test-bucket.s3.us-east-1.amazonaws.com/dj-audio/scripts/abc/1.mp3',
    );
  });

  it('builds key without prefix when prefix is empty', async () => {
    const noPrefix = new S3StorageAdapter('test-bucket', 'us-east-1', '');
    mockSend.mockResolvedValueOnce({});
    await noPrefix.write('file.mp3', Buffer.from('x'));
    const command = mockSend.mock.calls[0][0];
    expect(command.input.Key).toBe('file.mp3');
  });
});
