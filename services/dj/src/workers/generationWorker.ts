import { getPool } from '../db.js';
import { llmComplete } from '../adapters/llm/openrouter.js';
import { getTtsAdapter } from '../adapters/tts/openai.js';
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder.js';
import { config } from '../config.js';
import type { DjGenerationJobData } from '../queues/djQueue.js';
import type { DjProfile, DjSegmentType, DjScriptTemplate } from '@playgen/types';

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

// Estimate MP3 duration from buffer size (assumes 128kbps bitrate)
function estimateMp3Duration(buffer: Buffer): number {
  return Math.round((buffer.length / (128000 / 8)) * 10) / 10;
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
  const ttsEnabled = !!(config.tts.openaiApiKey || config.tts.elevenlabsApiKey);

  // Collect all generated segments for TTS pass
  const generatedSegments: Array<{
    id: string;
    script_text: string;
    position: number;
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
        { model: profile.llm_model, temperature: profile.llm_temperature },
      );

      const pos = position++;
      const { rows: segRows } = await pool.query<{ id: string }>(
        `INSERT INTO dj_segments
           (script_id, playlist_entry_id, segment_type, position, script_text)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [script_id, entry.id, segment_type, pos, script_text],
      );

      generatedSegments.push({ id: segRows[0].id, script_text, position: pos });
    }
  }

  // 7. TTS pass — generate audio for each segment
  if (ttsEnabled) {
    try {
      const ttsAdapter = getTtsAdapter();
      const fs = await import('fs/promises');
      const path = await import('path');
      const audioDir = path.join('/tmp', 'dj-audio', script_id);
      await fs.mkdir(audioDir, { recursive: true });

      for (const seg of generatedSegments) {
        try {
          const outputPath = path.join(audioDir, `${seg.position}.mp3`);
          const result = await ttsAdapter.generate({
            voice_id: profile!.tts_voice_id,
            text: seg.script_text,
            output_path: outputPath,
          });

          // Estimate duration from file size if adapter didn't provide it
          let duration = result.duration_sec;
          if (duration === null) {
            const stat = await fs.stat(outputPath);
            duration = estimateMp3Duration(Buffer.alloc(stat.size));
          }

          // Store relative audio URL for serving via static route
          const audioUrl = `/dj/audio/${script_id}/${seg.position}.mp3`;
          await pool.query(
            `UPDATE dj_segments SET audio_url = $1, audio_duration_sec = $2 WHERE id = $3`,
            [audioUrl, duration, seg.id],
          );
        } catch (ttsErr) {
          console.error(`[generationWorker] TTS failed for segment ${seg.id}:`, ttsErr);
          // Continue — text is still saved even if TTS fails
        }
      }
    } catch (ttsSetupErr) {
      console.error('[generationWorker] TTS adapter initialization failed:', ttsSetupErr);
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
}
