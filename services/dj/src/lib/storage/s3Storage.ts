import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { config } from '../../config.js';
import type { StorageAdapter } from './interface.js';

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private region: string;

  constructor(
    bucket: string = config.storage.s3Bucket,
    region: string = config.storage.s3Region,
    prefix: string = config.storage.s3Prefix,
  ) {
    this.bucket = bucket;
    this.region = region;
    this.prefix = prefix;

    this.client = new S3Client({
      region,
      ...(config.storage.awsAccessKeyId && config.storage.awsSecretAccessKey
        ? {
            credentials: {
              accessKeyId: config.storage.awsAccessKeyId,
              secretAccessKey: config.storage.awsSecretAccessKey,
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
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${this.key(filePath)}`;
  }
}
