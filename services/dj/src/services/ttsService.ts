import { getTtsAdapter } from '../adapters/tts/openai.js';
import { getStorageAdapter } from '../lib/storage/index.js';
import { config } from '../config.js';
import { getPool } from '../db.js';

/** Estimate MP3 duration from buffer size (assumes 128 kbps bitrate). */
export function estimateMp3Duration(buffer: Buffer): number {
  return Math.round((buffer.length / (128000 / 8)) * 10) / 10;
}

export interface TtsSegmentInput {
  /** Database segment ID */
  id: string;
  /** Position index — used to name the output file */
  position: number;
  /** Script text to synthesise (caller resolves edited_text vs script_text) */
  text: string;
  /** Script ID — used to build the audio directory path */
  script_id: string;
}

export interface TtsProviderConfig {
  provider: string;
  apiKey: string;
  voiceId: string;
}

/**
 * Generate TTS audio for a single segment, persist the file, and update the
 * `dj_segments` row with `audio_url`, `audio_duration_sec`.
 *
 * Returns the new `audio_url` on success.
 */
export async function generateSegmentTts(
  segment: TtsSegmentInput,
  providerCfg: TtsProviderConfig,
): Promise<{ audio_url: string; audio_duration_sec: number | null }> {
  const ttsAdapter = getTtsAdapter({
    provider: providerCfg.provider,
    apiKey: providerCfg.apiKey,
  });

  const result = await ttsAdapter.generate({
    voice_id: providerCfg.voiceId,
    text: segment.text,
  });

  let duration = result.duration_sec;
  if (duration === null) {
    duration = estimateMp3Duration(result.audio_data);
  }

  // Write via storage adapter so reads (served via GET /dj/segments/:id/audio)
  // always resolve against the same base path regardless of provider (local / S3).
  const storagePath = `${segment.script_id}/${segment.position}.mp3`;
  const storage = getStorageAdapter();
  await storage.write(storagePath, result.audio_data);

  const audioUrl = `/api/v1/dj/audio/${storagePath}`;

  await getPool().query(
    `UPDATE dj_segments
     SET audio_url = $1, audio_duration_sec = $2, updated_at = NOW()
     WHERE id = $3`,
    [audioUrl, duration, segment.id],
  );

  return { audio_url: audioUrl, audio_duration_sec: duration };
}

/**
 * Load the effective TTS provider config for a station, falling back to
 * global env vars when station-level overrides are not set.
 *
 * `voiceId` must be provided by the caller (resolved from the DJ profile).
 */
export async function loadTtsProviderConfig(
  stationId: string,
  fallbackVoiceId: string,
): Promise<TtsProviderConfig | null> {
  const { rows } = await getPool().query<{ key: string; value: string }>(
    `SELECT key, value FROM station_settings WHERE station_id = $1`,
    [stationId],
  );
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const provider = settings['tts_provider'] ?? config.tts.provider;
  const apiKey =
    settings['tts_api_key'] ??
    (provider === 'elevenlabs'
      ? config.tts.elevenlabsApiKey
      : provider === 'google' || provider === 'gemini_tts'
      ? config.tts.geminiApiKey
      : provider === 'mistral'
      ? config.tts.mistralApiKey
      : config.tts.openaiApiKey);
  const voiceId = settings['tts_voice_id'] ?? fallbackVoiceId;

  if (!apiKey) return null;

  return { provider, apiKey, voiceId };
}
