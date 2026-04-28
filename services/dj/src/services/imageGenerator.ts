/**
 * DALL-E 3 image generation for DJ avatars and station artwork.
 *
 * Generated images are downloaded from OpenAI's temporary URL and re-uploaded
 * to R2/S3 for permanent storage before the URL is persisted in the DB.
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { getStorageAdapter } from '../lib/storage/index.js';

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: config.tts.openaiApiKey });
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Generate a portrait avatar for a DJ profile using DALL-E 3.
 * Downloads the result and uploads to R2; updates dj_profiles.avatar_url when done.
 */
export async function generateDjAvatar(profile: {
  id: string;
  name: string;
  personality?: string | null;
}): Promise<void> {
  if (!config.tts.openaiApiKey) {
    console.warn('[imageGenerator] OPENAI_API_KEY not set — skipping DJ avatar generation');
    return;
  }

  const bioExcerpt = profile.personality
    ? profile.personality.slice(0, 100)
    : 'charismatic radio host';

  const prompt =
    `Cinematic portrait of a radio DJ named "${profile.name}", ${bioExcerpt}. ` +
    `Professional studio lighting, radio broadcast aesthetic. No text, no watermarks, no logos.`;

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
      console.warn('[imageGenerator] DALL-E returned no URL for DJ avatar', { profileId: profile.id });
      return;
    }

    const buffer = await downloadImage(tempUrl);
    const storage = getStorageAdapter();
    const key = `images/dj/${profile.id}/avatar.jpg`;
    await storage.write(key, buffer);
    const permanentUrl = storage.getPublicUrl(key);

    await getPool().query(
      `UPDATE dj_profiles SET avatar_url = $1, updated_at = NOW() WHERE id = $2`,
      [permanentUrl, profile.id],
    );

    console.info('[imageGenerator] DJ avatar generated and stored', { profileId: profile.id, url: permanentUrl });
  } catch (err) {
    console.error('[imageGenerator] DJ avatar generation failed', { profileId: profile.id, err });
  }
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
  if (!config.tts.openaiApiKey) {
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
    const storage = getStorageAdapter();
    const key = `images/stations/${station.id}/artwork.jpg`;
    await storage.write(key, buffer);
    const permanentUrl = storage.getPublicUrl(key);

    await getPool().query(
      `UPDATE stations SET artwork_url = $1, updated_at = NOW() WHERE id = $2`,
      [permanentUrl, station.id],
    );

    console.info('[imageGenerator] Station artwork generated and stored', { stationId: station.id, url: permanentUrl });
  } catch (err) {
    console.error('[imageGenerator] Station artwork generation failed', { stationId: station.id, err });
  }
}
