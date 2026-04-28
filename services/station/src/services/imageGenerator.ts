/**
 * DALL-E 3 image generation for station artwork.
 *
 * Generated images are downloaded from OpenAI's temporary URL and re-uploaded
 * to R2/S3 for permanent storage before the URL is persisted in the DB.
 */
import OpenAI from 'openai';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getPool } from '../db';

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey });
}

function getS3Client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    },
  });
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadToR2(key: string, buffer: Buffer): Promise<string> {
  const bucket = process.env.S3_BUCKET ?? '';
  const publicBase = (process.env.S3_PUBLIC_URL_BASE ?? '').replace(/\/$/, '');

  if (!bucket || !publicBase) throw new Error('S3_BUCKET and S3_PUBLIC_URL_BASE must be set');

  const s3 = getS3Client();
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
  }));

  return `${publicBase}/${key}`;
}

/**
 * Generate abstract cover art for a station using DALL-E 3.
 * Downloads the result and uploads to R2; updates stations.artwork_url when done.
 */
export async function generateStationArtwork(station: {
  id: string;
  name: string;
  genre?: string | null;
}): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[imageGenerator] OPENAI_API_KEY not set — skipping station artwork generation');
    return;
  }

  const genre = station.genre ?? 'contemporary';
  const prompt =
    `Abstract album cover art for a ${genre} radio station called "${station.name}". ` +
    `Vibrant, artistic, mood-evoking. No text, no words, no letters, no watermarks.`;

  try {
    const client = getOpenAIClient();
    const response = await client.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });

    const tempUrl = response.data?.[0]?.url;
    if (!tempUrl) {
      console.warn('[imageGenerator] DALL-E returned no URL for station artwork', { stationId: station.id });
      return;
    }

    const buffer = await downloadImage(tempUrl);
    const permanentUrl = await uploadToR2(`images/stations/${station.id}/artwork.jpg`, buffer);

    await getPool().query(
      `UPDATE stations SET artwork_url = $1, updated_at = NOW() WHERE id = $2`,
      [permanentUrl, station.id],
    );

    console.info('[imageGenerator] Station artwork generated and stored', { stationId: station.id, url: permanentUrl });
  } catch (err) {
    console.error('[imageGenerator] Station artwork generation failed', { stationId: station.id, err });
  }
}
