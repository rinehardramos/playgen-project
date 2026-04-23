import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
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

  async write(filePath: string, data: Buffer | Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(filePath),
        Body: data,
        ContentType: 'audio/mpeg',
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

  /** Expose the S3 client for presigned URL generation. */
  getClient(): S3Client { return this.client; }
  getBucket(): string { return this.bucket; }
  buildKey(filePath: string): string { return this.key(filePath); }
}
