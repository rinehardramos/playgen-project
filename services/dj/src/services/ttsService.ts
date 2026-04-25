import { getTtsAdapter } from '../adapters/tts/openai.js';
import { getStorageAdapter } from '../lib/storage/index.js';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { logTtsUsage } from '../lib/usageLogger.js';
import { checkTtsRateLimit } from '../lib/rateLimiter.js';

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
  /** Station ID — used for usage logging */
  station_id?: string;
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
  // Soft TTS rate limit check (only when station_id is available)
  if (segment.station_id) {
    const ttsRateCheck = await checkTtsRateLimit(segment.station_id, segment.text.length);
    if (!ttsRateCheck.allowed) {
      throw new Error(`TTS rate limit exceeded: ${ttsRateCheck.reason}`);
    }
  }

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

  // Write via storage adapter (local disk or S3/R2)
  const storagePath = `${segment.script_id}/${segment.position}.mp3`;
  const storage = getStorageAdapter();
  await storage.write(storagePath, result.audio_data);

  // Use CDN URL when storage is S3 (required for HLS streaming);
  // fall back to relative API path for local storage.
  // Append cache-bust param so CDN serves the fresh file after re-generation.
  const publicUrl = storage.getPublicUrl(storagePath);
  const cacheBust = `v=${Date.now()}`;
  const audioUrl = publicUrl.startsWith('http')
    ? `${publicUrl}?${cacheBust}`
    : `/api/v1/dj/audio/${storagePath}`;

  await getPool().query(
    `UPDATE dj_segments
     SET audio_url = $1, audio_duration_sec = $2, updated_at = NOW()
     WHERE id = $3`,
    [audioUrl, duration, segment.id],
  );

  // Fire-and-forget TTS usage log
  if (segment.station_id) {
    logTtsUsage({
      station_id: segment.station_id,
      script_id: segment.script_id,
      segment_id: segment.id,
      provider: providerCfg.provider,
      character_count: segment.text.length,
      metadata: { voice_id: providerCfg.voiceId },
    });
  }

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
  const pool = getPool();

  // Load per-station key-value settings (tts_provider, tts_voice_id, tts_api_key override)
  const { rows: settingRows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM station_settings WHERE station_id = $1`,
    [stationId],
  );
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));

  // Load station-level API key columns (saved via the Settings page)
  const { rows: stationRows } = await pool.query<{
    elevenlabs_api_key: string | null;
    openai_api_key: string | null;
    gemini_api_key: string | null;
    mistral_api_key: string | null;
  }>(
    `SELECT elevenlabs_api_key, openai_api_key, gemini_api_key, mistral_api_key
     FROM stations WHERE id = $1`,
    [stationId],
  );
  const stationKeys = stationRows[0] ?? {};

  const provider = settings['tts_provider'] ?? config.tts.provider;

  // Priority: explicit tts_api_key setting → station column → env var
  const apiKey =
    settings['tts_api_key'] ??
    (provider === 'elevenlabs'
      ? (stationKeys.elevenlabs_api_key ?? config.tts.elevenlabsApiKey)
      : provider === 'google' || provider === 'gemini_tts'
      ? (stationKeys.gemini_api_key ?? config.tts.geminiApiKey)
      : provider === 'mistral'
      ? (stationKeys.mistral_api_key ?? config.tts.mistralApiKey)
      : (stationKeys.openai_api_key ?? config.tts.openaiApiKey));

  const voiceId = settings['tts_voice_id'] ?? fallbackVoiceId;

  if (!apiKey) return null;

  return { provider, apiKey, voiceId };
}
