/**
 * DALL-E 3 image generation for DJ avatars and station artwork.
 *
 * Generated URLs are stored directly in the DB — no re-upload to R2/S3.
 * OpenAI temporary URLs expire after ~1 hour, which is acceptable for now.
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import { getPool } from '../db.js';

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: config.tts.openaiApiKey });
}

/**
 * Generate a portrait avatar for a DJ profile using DALL-E 3.
 * Fires-and-forgets from the caller; updates dj_profiles.avatar_url when done.
 */
export async function generateDjAvatar(profile: {
  id: string;
  name: string;
  personality?: string | null;
}): Promise<void> {
  const apiKey = config.tts.openaiApiKey;
  if (!apiKey) {
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

    const url = response.data?.[0]?.url;
    if (!url) {
      console.warn('[imageGenerator] DALL-E returned no URL for DJ avatar', { profileId: profile.id });
      return;
    }

    await getPool().query(
      `UPDATE dj_profiles SET avatar_url = $1, updated_at = NOW() WHERE id = $2`,
      [url, profile.id],
    );

    console.info('[imageGenerator] DJ avatar generated', { profileId: profile.id });
  } catch (err) {
    console.error('[imageGenerator] DJ avatar generation failed', { profileId: profile.id, err });
  }
}

/**
 * Generate abstract cover art for a station using DALL-E 3.
 * Fires-and-forgets from the caller; updates stations.artwork_url when done.
 */
export async function generateStationArtwork(station: {
  id: string;
  name: string;
  genre?: string | null;
}): Promise<void> {
  const apiKey = config.tts.openaiApiKey;
  if (!apiKey) {
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

    const url = response.data?.[0]?.url;
    if (!url) {
      console.warn('[imageGenerator] DALL-E returned no URL for station artwork', { stationId: station.id });
      return;
    }

    await getPool().query(
      `UPDATE stations SET artwork_url = $1, updated_at = NOW() WHERE id = $2`,
      [url, station.id],
    );

    console.info('[imageGenerator] Station artwork generated', { stationId: station.id });
  } catch (err) {
    console.error('[imageGenerator] Station artwork generation failed', { stationId: station.id, err });
  }
}
