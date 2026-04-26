import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageAdapter, StorageConfig } from './interface.js';

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private region: string;
  private s3PublicUrlBase?: string;

  constructor(config: Pick<StorageConfig, 's3Bucket' | 's3Region' | 's3Prefix' | 's3Endpoint' | 's3PublicUrlBase' | 'awsAccessKeyId' | 'awsSecretAccessKey'>) {
    this.bucket = config.s3Bucket ?? '';
    this.region = config.s3Region ?? 'us-east-1';
    this.prefix = config.s3Prefix ?? '';
    this.s3PublicUrlBase = config.s3PublicUrlBase;

    this.client = new S3Client({
      region: this.region,
      // Custom endpoint for R2 (Cloudflare) or B2 (Backblaze) — S3-compatible
      ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
      forcePathStyle: !!config.s3Endpoint, // Required for R2/B2
      ...(config.awsAccessKeyId && config.awsSecretAccessKey
        ? {
            credentials: {
              accessKeyId: config.awsAccessKeyId,
              secretAccessKey: config.awsSecretAccessKey,
            },
          }
        : {}),
    });
  }

  /** Build the full S3 key from a relative file path. */
  private key(filePath: string): string {
    return this.prefix ? `${this.prefix}/${filePath}` : filePath;
  }

  /** Infer content type from file extension. */
  private contentType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      mp4: 'video/mp4',
      m4s: 'video/iso.segment',
      m3u8: 'application/vnd.apple.mpegurl',
      json: 'application/json',
    };
    return types[ext ?? ''] ?? 'application/octet-stream';
  }

  async write(filePath: string, data: Buffer | Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(filePath),
        Body: data,
        ContentType: this.contentType(filePath),
      }),
    );
  }

  async read(filePath: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(filePath),
      }),
    );

    if (!response.Body) {
      throw new Error(`S3 object body is empty for key: ${this.key(filePath)}`);
    }

    // `Body` is a Readable stream in Node.js — collect chunks into a Buffer.
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.key(filePath),
        }),
      );
      return true;
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async delete(filePath: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.key(filePath),
      }),
    );
  }

  getPublicUrl(filePath: string): string {
    // R2 custom domain or B2 friendly URL
    if (this.s3PublicUrlBase) {
      return `${this.s3PublicUrlBase}/${this.key(filePath)}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${this.key(filePath)}`;
  }

  /**
   * Generate a presigned PUT URL for direct client → S3/R2/B2 upload.
   * The client can PUT an audio file directly to object storage, bypassing the API.
   */
  async getPresignedPutUrl(filePath: string, contentType = 'audio/mpeg', expiresIn = 3600): Promise<string> {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: this.key(filePath), ContentType: contentType });
    return getSignedUrl(this.client, cmd, { expiresIn });
  }

  /**
   * Generate a presigned GET URL for direct client download.
   */
  async getPresignedGetUrl(filePath: string, expiresIn = 3600): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: this.key(filePath) });
    return getSignedUrl(this.client, cmd, { expiresIn });
  }

  /** Expose the S3 client for presigned URL generation. */
  getClient(): S3Client { return this.client; }
  getBucket(): string { return this.bucket; }
  buildKey(filePath: string): string { return this.key(filePath); }
}
