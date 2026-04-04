import { getPool } from '../db.js';
import { llmComplete } from '../adapters/llm/openrouter.js';
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder.js';
import { config } from '../config.js';
import { getStorageAdapter } from '../lib/storage/index.js';
import { buildAudioPath } from '../utils/audioPath.js';
import { buildManifest } from '../services/manifestService.js';
import type { DjGenerationJobData } from '../queues/djQueue.js';
import type { DjProfile, DjSegmentType, DjScriptTemplate } from '@playgen/types';

/** Fetch all station_settings for a given station into a key→value map (real values, un-masked). */
async function loadStationSettings(stationId: string): Promise<Record<string, string>> {
  const { rows } = await getPool().query<{ key: string; value: string }>(
    `SELECT key, value FROM station_settings WHERE station_id = $1`,
    [stationId],
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

interface PlaylistEntryRow {
  id: string;
  hour: number;
  position: number;
  song_title: string;
  song_artist: string;
  duration_sec: number | null;
}

interface StationRow {
  id: string;
  name: string;
  timezone: string;
  company_id: string;
}

// Determine which segment types to generate for a given playlist position
function segmentsForEntry(
  entry: PlaylistEntryRow,
  entries: PlaylistEntryRow[],
  idx: number,
): DjSegmentType[] {
  const types: DjSegmentType[] = [];
  const isFirst = idx === 0;
  const isLast = idx === entries.length - 1;

  if (isFirst) types.push('show_intro');
  types.push(isFirst ? 'song_intro' : 'song_transition');
  if (isLast) types.push('show_outro');

  return types;
}

export async function runGenerationJob(data: DjGenerationJobData): Promise<void> {
  const pool = getPool();
  const start = Date.now();

  // 1. Load station info
  const { rows: stationRows } = await pool.query<StationRow>(
    `SELECT id, name, timezone, company_id FROM stations WHERE id = $1`,
    [data.station_id],
  );
  const station = stationRows[0];
  if (!station) throw new Error(`Station ${data.station_id} not found`);

  // 1b. Load per-station settings (API key overrides, model, TTS provider, etc.)
  const stationSettings = await loadStationSettings(data.station_id);

  // 2. Load DJ profile
  let profile: DjProfile | null = null;
  if (data.dj_profile_id) {
    const { rows } = await pool.query<DjProfile>(
      `SELECT * FROM dj_profiles WHERE id = $1`,
      [data.dj_profile_id],
    );
    profile = rows[0] ?? null;
  }
  if (!profile) {
    const { getDefaultProfile } = await import('../services/profileService.js');
    profile = await getDefaultProfile(station.company_id);
  }
  if (!profile) throw new Error('No DJ profile found for station');

  // 3. Load playlist entries with song data
  const { rows: playlistRows } = await pool.query<{ playlist_date: Date }>(
    'SELECT playlist_date FROM playlists WHERE id = $1',
    [data.playlist_id],
  );
  if (!playlistRows[0]) throw new Error(`Playlist ${data.playlist_id} not found`);
  const playlistDate = playlistRows[0].playlist_date.toISOString().split('T')[0];

  const { rows: entries } = await pool.query<PlaylistEntryRow>(
    `SELECT pe.id, pe.hour, pe.position,
            s.title AS song_title, s.artist AS song_artist, s.duration_sec
     FROM playlist_entries pe
     JOIN songs s ON s.id = pe.song_id
     WHERE pe.playlist_id = $1
     ORDER BY pe.hour, pe.position`,
    [data.playlist_id],
  );
  if (entries.length === 0) throw new Error('Playlist has no entries');

  // 4. Batch-load all script templates for this station
  const { rows: templateRows } = await pool.query<DjScriptTemplate>(
    `SELECT * FROM dj_script_templates WHERE station_id = $1 AND is_active = true`,
    [data.station_id],
  );
  const templateMap = new Map<string, string>();
  for (const t of templateRows) {
    templateMap.set(t.segment_type, t.prompt_template);
  }

  // 5. Create the script record
  const { rows: scriptRows } = await pool.query(
    `INSERT INTO dj_scripts
       (playlist_id, station_id, dj_profile_id, review_status, llm_model, total_segments)
     VALUES ($1, $2, $3, $4, $5, 0)
     RETURNING id`,
    [
      data.playlist_id,
      data.station_id,
      profile.id,
      data.auto_approve ? 'auto_approved' : 'pending_review',
      profile.llm_model,
    ],
  );
  const script_id: string = scriptRows[0].id;

  // 6. Generate segments
  const currentDate = new Date().toISOString().split('T')[0];
  let position = 0;

  // Resolve effective TTS / LLM config: station setting overrides fall back to env vars.
  const effectiveTtsProvider = stationSettings['tts_provider'] ?? config.tts.provider;
  const effectiveTtsApiKey   = stationSettings['tts_api_key']
    ?? (effectiveTtsProvider === 'elevenlabs' ? config.tts.elevenlabsApiKey : config.tts.openaiApiKey);
  const effectiveTtsVoiceId  = stationSettings['tts_voice_id'] ?? profile.tts_voice_id;
  const effectiveLlmModel    = stationSettings['llm_model'] ?? profile.llm_model;
  const effectiveLlmApiKey   = stationSettings['llm_api_key'] ?? undefined;

  const ttsEnabled = !!(effectiveTtsApiKey);

  // Collect all generated segments for TTS pass
  const generatedSegments: Array<{
    id: string;
    script_text: string;
    position: number;
    segment_type: DjSegmentType;
    hour: number;
  }> = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const prev = entries[i - 1];
    const next = entries[i + 1];
    const segmentTypes = segmentsForEntry(entry, entries, i);

    for (const segment_type of segmentTypes) {
      const customTemplate = templateMap.get(segment_type);

      // Build rejection context if this is a rewrite
      let rejectionContext = '';
      if (data.rejection_notes) {
        rejectionContext = `\n\nIMPORTANT: The previous script was rejected by the reviewer. Their feedback: "${data.rejection_notes}". Please rewrite accordingly.`;
      }

      const ctx = {
        station_name: station.name,
        station_timezone: station.timezone,
        current_date: currentDate,
        current_hour: entry.hour,
        dj_profile: profile,
        prev_song: prev ? { title: prev.song_title, artist: prev.song_artist, duration_sec: prev.duration_sec } : undefined,
        next_song: next ? { title: next.song_title, artist: next.song_artist, duration_sec: next.duration_sec } : undefined,
        segment_type,
        custom_template: customTemplate,
      };

      const systemPrompt = buildSystemPrompt(profile);
      const userPrompt = buildUserPrompt(ctx) + rejectionContext;

      const script_text = await llmComplete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        {
          model: effectiveLlmModel,
          temperature: profile.llm_temperature,
          apiKey: effectiveLlmApiKey,
        },
      );

      const pos = position++;
      const { rows: segRows } = await pool.query<{ id: string }>(
        `INSERT INTO dj_segments
           (script_id, playlist_entry_id, segment_type, position, script_text)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [script_id, entry.id, segment_type, pos, script_text],
      );

      generatedSegments.push({ 
        id: segRows[0].id, 
        script_text, 
        position: pos,
        segment_type,
        hour: entry.hour
      });
    }
  }

  // 7. TTS pass — generate audio for each segment
  if (ttsEnabled) {
    try {
      const ttsAdapter = getTtsAdapter({
        provider: effectiveTtsProvider,
        apiKey: effectiveTtsApiKey,
      });
      const storage = getStorageAdapter();
      const fs = await import('fs/promises');
      const path = await import('path');

      for (const seg of generatedSegments) {
        try {
          const relativePath = buildAudioPath({
            companyId: station.company_id,
            stationId: station.id,
            playlistDate,
            scriptId: script_id,
            type: seg.segment_type,
            hour: seg.hour,
            position: seg.position,
          });

          const result = await ttsAdapter.generate({
            voice_id: effectiveTtsVoiceId,
            text: seg.script_text,
          });

          // Estimate duration if adapter didn't provide it
          let duration = result.duration_sec;
          if (duration === null) {
            duration = estimateMp3Duration(result.audio_data);
          }

          // Use storage adapter to write the file
          await storage.write(relativePath, result.audio_data);

          // Store public audio URL from storage adapter
          const audioUrl = storage.getPublicUrl(relativePath);
          await pool.query(
            `UPDATE dj_segments SET audio_url = $1, audio_duration_sec = $2 WHERE id = $3`,
            [audioUrl, duration, seg.id],
          );
        } catch (ttsErr) {
          console.error(`[generationWorker] TTS failed for segment ${seg.id}:`, ttsErr);
        }
      }
    }
  }

  // 8. Update script with final segment count + generation time
  const generation_ms = Date.now() - start;
  await pool.query(
    `UPDATE dj_scripts
     SET total_segments = $2, generation_ms = $3, updated_at = NOW()
     WHERE id = $1`,
    [script_id, position, generation_ms],
  );

  // 9. Auto-build manifest
  try {
    await buildManifest(script_id);
  } catch (manifestErr) {
    console.error(`[generationWorker] Failed to build manifest for script ${script_id}:`, manifestErr);
  }
}
