import path from 'path';
import fs from 'fs/promises';
import { getTtsAdapter } from '../adapters/tts/openai.js';
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

  const audioDir = path.join('/tmp', 'dj-audio', segment.script_id);
  await fs.mkdir(audioDir, { recursive: true });

  const outputPath = path.join(audioDir, `${segment.position}.mp3`);
  const result = await ttsAdapter.generate({
    voice_id: providerCfg.voiceId,
    text: segment.text,
  });

  await fs.writeFile(outputPath, result.audio_data);

  let duration = result.duration_sec;
  if (duration === null) {
    duration = estimateMp3Duration(result.audio_data);
  }

  const audioUrl = `/dj/audio/${segment.script_id}/${segment.position}.mp3`;

  await getPool().query(
    `UPDATE dj_segments
     SET audio_url = $1, audio_duration_sec = $2, updated_at = NOW()
     WHERE id = $3`,
    [audioUrl, duration, segment.id],
  );

  return { audio_url: audioUrl, audio_duration_sec: duration };
}

/**
 * Run TTS audio generation for all segments of a script.
 * Called after a script is approved (review-enabled path).
 * Silently skips segments that already have audio_url set.
 */
export async function generateScriptAudio(
  scriptId: string,
  providerCfg: TtsProviderConfig,
): Promise<void> {
  const pool = getPool();
  const { rows: segments } = await pool.query<{
    id: string;
    position: number;
    script_text: string;
    edited_text: string | null;
    audio_url: string | null;
  }>(
    `SELECT id, position, script_text, edited_text, audio_url
     FROM dj_segments WHERE script_id = $1 ORDER BY position`,
    [scriptId],
  );

  for (const seg of segments) {
    if (seg.audio_url) continue; // already has audio
    const text = seg.edited_text ?? seg.script_text;
    try {
      await generateSegmentTts(
        { id: seg.id, position: seg.position, text, script_id: scriptId },
        providerCfg,
      );
    } catch (err) {
      console.error(`[ttsService] TTS failed for segment ${seg.id}:`, err);
      // Continue — partial audio is better than no audio
    }
  }
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
    (provider === 'elevenlabs' ? config.tts.elevenlabsApiKey : config.tts.openaiApiKey);
  const voiceId = settings['tts_voice_id'] ?? fallbackVoiceId;

  if (!apiKey) return null;

  return { provider, apiKey, voiceId };
}
