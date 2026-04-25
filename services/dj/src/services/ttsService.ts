import { getTtsAdapter } from '../adapters/tts/openai.js';
import { getStorageAdapter } from '../lib/storage/index.js';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { logTtsUsage } from '../lib/usageLogger.js';
import { checkTtsRateLimit } from '../lib/rateLimiter.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

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

  // Transcode MP3 → AAC for codec consistency with HLS song segments
  let audioData = result.audio_data;
  let duration = result.duration_sec;
  const storagePath = `${segment.script_id}/${segment.position}.m4a`;

  try {
    const tmpIn = path.join(os.tmpdir(), `tts-${segment.id}.mp3`);
    const tmpOut = path.join(os.tmpdir(), `tts-${segment.id}.m4a`);
    fs.writeFileSync(tmpIn, result.audio_data);
    await execFileAsync('ffmpeg', [
      '-i', tmpIn, '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '1',
      '-y', tmpOut,
    ], { timeout: 15000 });
    audioData = fs.readFileSync(tmpOut);
    // Get precise duration from ffprobe
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet', '-print_format', 'json', '-show_format', tmpOut,
      ], { timeout: 5000 });
      const info = JSON.parse(stdout);
      duration = parseFloat(info.format.duration);
    } catch { /* keep estimate */ }
    fs.unlinkSync(tmpIn);
    fs.unlinkSync(tmpOut);
  } catch (err) {
    // Fallback: use original MP3 if ffmpeg unavailable
    console.warn('[tts] AAC transcode failed, using MP3:', err);
    if (duration === null) duration = estimateMp3Duration(result.audio_data);
  }

  if (duration === null) duration = estimateMp3Duration(result.audio_data);

  const storage = getStorageAdapter();
  await storage.write(storagePath, audioData);

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

// ── Dialogue TTS (multi-speaker) ─────────────────────────────────────────────

interface DialogueLine {
  speaker: string;
  text: string;
}

/** Parse [Speaker] tagged dialogue into ordered lines. */
export function parseDialogueLines(scriptText: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  const regex = /\[([^\]]+)\]\s*/g;
  let lastIndex = 0;
  let lastSpeaker = '';
  let match: RegExpExecArray | null;

  while ((match = regex.exec(scriptText)) !== null) {
    // Text before this tag belongs to the previous speaker
    if (lastSpeaker && lastIndex < match.index) {
      const text = scriptText.slice(lastIndex, match.index).trim();
      if (text) lines.push({ speaker: lastSpeaker, text });
    }
    lastSpeaker = match[1];
    lastIndex = match.index + match[0].length;
  }
  // Remaining text after last tag
  if (lastSpeaker && lastIndex < scriptText.length) {
    const text = scriptText.slice(lastIndex).trim();
    if (text) lines.push({ speaker: lastSpeaker, text });
  }

  return lines;
}

/** Check if script text contains [Speaker] dialogue tags. */
export function isDialogueText(text: string): boolean {
  return /\[[A-Z][a-zA-Z]*\]\s/.test(text);
}

/**
 * Generate TTS for a multi-speaker dialogue segment.
 * Parses [Speaker] tags, generates TTS per speaker with different voices,
 * concatenates with short silence gaps via ffmpeg.
 */
export async function generateDialogueTts(
  segment: TtsSegmentInput,
  providerCfg: TtsProviderConfig,
  voiceMap: Record<string, string>,
): Promise<{ audio_url: string; audio_duration_sec: number | null }> {
  const lines = parseDialogueLines(segment.text);
  if (lines.length === 0) {
    // Fallback to single-voice if no tags found
    return generateSegmentTts(segment, providerCfg);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialogue-'));
  const clipPaths: string[] = [];

  try {
    // Generate TTS for each speaker's line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const voiceId = voiceMap[line.speaker] ?? providerCfg.voiceId;

      const ttsAdapter = getTtsAdapter({
        provider: providerCfg.provider,
        apiKey: providerCfg.apiKey,
      });

      const result = await ttsAdapter.generate({
        voice_id: voiceId,
        text: line.text,
      });

      const clipPath = path.join(tmpDir, `clip-${String(i).padStart(3, '0')}.mp3`);
      fs.writeFileSync(clipPath, result.audio_data);
      clipPaths.push(clipPath);
    }

    // Generate 200ms silence gap (MP3 to match TTS clips for concat copy)
    const silencePath = path.join(tmpDir, 'silence.mp3');
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono',
      '-t', '0.2', '-c:a', 'libmp3lame', '-b:a', '64k',
      '-y', silencePath,
    ], { timeout: 10000 });

    // Build ffmpeg concat list (clip, silence, clip, silence, ...)
    const concatListPath = path.join(tmpDir, 'concat.txt');
    const concatEntries: string[] = [];
    for (let i = 0; i < clipPaths.length; i++) {
      concatEntries.push(`file '${clipPaths[i]}'`);
      if (i < clipPaths.length - 1) {
        concatEntries.push(`file '${silencePath}'`);
      }
    }
    fs.writeFileSync(concatListPath, concatEntries.join('\n'));

    // Concatenate (keep as MP3 — same codec as TTS clips)
    const concatPath = path.join(tmpDir, 'concat.mp3');
    await execFileAsync('ffmpeg', [
      '-f', 'concat', '-safe', '0', '-i', concatListPath,
      '-c:a', 'copy', '-y', concatPath,
    ], { timeout: 30000 });

    // Transcode concatenated MP3 → AAC for codec consistency
    const aacPath = path.join(tmpDir, 'final.m4a');
    await execFileAsync('ffmpeg', [
      '-i', concatPath, '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '1',
      '-y', aacPath,
    ], { timeout: 30000 });

    const dialogueAudio = fs.readFileSync(aacPath);
    let finalDuration: number | null = null;
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet', '-print_format', 'json', '-show_format', aacPath,
      ], { timeout: 5000 });
      finalDuration = parseFloat(JSON.parse(stdout).format.duration);
    } catch {
      finalDuration = estimateMp3Duration(dialogueAudio);
    }

    const storagePath = `${segment.script_id}/${segment.position}.m4a`;
    const storage = getStorageAdapter();
    await storage.write(storagePath, dialogueAudio);

    const publicUrl = storage.getPublicUrl(storagePath);
    const cacheBust = `v=${Date.now()}`;
    const audioUrl = publicUrl.startsWith('http')
      ? `${publicUrl}?${cacheBust}`
      : `/api/v1/dj/audio/${storagePath}`;

    await getPool().query(
      `UPDATE dj_segments
       SET audio_url = $1, audio_duration_sec = $2, updated_at = NOW()
       WHERE id = $3`,
      [audioUrl, finalDuration, segment.id],
    );

    return { audio_url: audioUrl, audio_duration_sec: finalDuration };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
  const pool = getPool();

  // Load per-station key-value settings (tts_provider, tts_voice_id, tts_api_key override)
  let { rows: settingRows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM station_settings WHERE station_id = $1`,
    [stationId],
  );

  // Company-level inheritance: if this station has no TTS settings,
  // look for any sibling station in the same company that does (#455)
  if (!settingRows.some(r => r.key === 'tts_provider')) {
    const { rows: inherited } = await pool.query<{ key: string; value: string }>(
      `SELECT ss.key, ss.value FROM station_settings ss
       JOIN stations s ON s.id = ss.station_id
       WHERE s.company_id = (SELECT company_id FROM stations WHERE id = $1)
         AND ss.station_id != $1
         AND ss.key IN ('tts_provider', 'tts_voice_id', 'tts_api_key')
       ORDER BY ss.station_id LIMIT 3`,
      [stationId],
    );
    if (inherited.length > 0) {
      settingRows = [...settingRows, ...inherited];
    }
  }

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
