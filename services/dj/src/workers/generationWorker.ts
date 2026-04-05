import { getPool } from '../db.js';
import { llmComplete } from '../adapters/llm/openrouter.js';
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder.js';
import { config } from '../config.js';
import { buildManifest } from '../services/manifestService.js';
import type { DjGenerationJobData, Job } from '../queues/djQueue.js';
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
  openrouter_api_key: string | null;
  openai_api_key: string | null;
  elevenlabs_api_key: string | null;
  anthropic_api_key: string | null;
  gemini_api_key: string | null;
  mistral_api_key: string | null;
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

export async function runGenerationJob(
  data: DjGenerationJobData,
  job?: Job<DjGenerationJobData>,
): Promise<void> {
  const pool = getPool();
  const start = Date.now();

  const reportProgress = async (pct: number, step: string) => {
    try {
      await job?.updateProgress({ pct, step });
    } catch {
      // Non-critical — don't let progress update failures abort the job
    }
  };

  await reportProgress(5, 'Loading station config…');

  // 1. Load station info (including API key columns saved via Settings page)
  const { rows: stationRows } = await pool.query<StationRow>(
    `SELECT id, name, timezone, company_id,
            openrouter_api_key, openai_api_key, elevenlabs_api_key, anthropic_api_key, gemini_api_key, mistral_api_key
     FROM stations WHERE id = $1`,
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

  // 2b. Pre-flight: fail fast if no LLM API key is available before creating any DB records.
  //     Both per-station keys (from station columns / station_settings) and env var defaults
  //     are checked so the error message tells the operator exactly what to configure.
  const earlyLlmProvider = stationSettings['llm_provider'] ?? config.llm.provider;
  const earlyLlmApiKey =
    stationSettings['llm_api_key'] ??
    (earlyLlmProvider === 'anthropic'
      ? station.anthropic_api_key
      : earlyLlmProvider === 'gemini'
      ? station.gemini_api_key
      : earlyLlmProvider === 'openai'
      ? station.openai_api_key
      : earlyLlmProvider === 'mistral'
      ? station.mistral_api_key
      : station.openrouter_api_key) ??
    undefined;
  const earlyLlmFallback =
    earlyLlmProvider === 'openai'
      ? config.llm.openaiApiKey
      : earlyLlmProvider === 'anthropic'
      ? config.llm.anthropicApiKey
      : config.openRouter.apiKey;
  if (!earlyLlmApiKey && !earlyLlmFallback) {
    throw new Error(
      `No LLM API key configured for provider "${earlyLlmProvider}". ` +
      `Set OPENROUTER_API_KEY (or the relevant key) in Railway environment variables, ` +
      `or add a per-station API key in Station Settings → DJ Settings.`,
    );
  }

  await reportProgress(10, 'Loading playlist…');

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

  // 4b. Load pending listener shoutouts for this station (max 3 per script)
  interface ShoutoutRow { id: string; listener_name: string | null; message: string; }
  const { rows: pendingShoutouts } = await pool.query<ShoutoutRow>(
    `SELECT id, listener_name, message FROM listener_shoutouts
     WHERE station_id = $1 AND status = 'pending'
     ORDER BY created_at ASC LIMIT 3`,
    [data.station_id],
  );

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

  // Resolve effective LLM config (TTS is now generated on-demand per segment)
  const effectiveLlmProvider = stationSettings['llm_provider'] ?? config.llm.provider;
  const effectiveLlmModel    = stationSettings['llm_model'] || profile.llm_model;

  const effectiveLlmApiKey = stationSettings['llm_api_key']
    ?? (effectiveLlmProvider === 'anthropic'
      ? station.anthropic_api_key
      : effectiveLlmProvider === 'gemini'
      ? station.gemini_api_key
      : effectiveLlmProvider === 'openai'
      ? station.openai_api_key
      : effectiveLlmProvider === 'mistral'
      ? station.mistral_api_key
      : station.openrouter_api_key)
    ?? undefined;

  const effectiveTtsProvider = (stationSettings['tts_provider'] ?? config.tts.provider) as string;
  const effectiveTtsApiKey = stationSettings['tts_api_key']
    ?? (effectiveTtsProvider === 'elevenlabs'
      ? station.elevenlabs_api_key
      : effectiveTtsProvider === 'google'
      ? station.gemini_api_key   // Google TTS uses the same Google/Gemini API key
      : effectiveTtsProvider === 'gemini_tts'
      ? station.gemini_api_key   // Gemini native TTS also uses the Gemini API key
      : effectiveTtsProvider === 'mistral'
      ? station.mistral_api_key
      : station.openai_api_key)
    ?? (effectiveTtsProvider === 'elevenlabs'
      ? config.tts.elevenlabsApiKey
      : effectiveTtsProvider === 'google'
      ? config.tts.googleApiKey
      : effectiveTtsProvider === 'gemini_tts'
      ? config.tts.geminiApiKey
      : effectiveTtsProvider === 'mistral'
      ? config.tts.mistralApiKey
      : config.tts.openaiApiKey);

  const _ttsEnabled = !!(effectiveTtsApiKey);

  // Collect all generated segments for TTS pass + variety context
  const generatedSegments: Array<{
    id: string;
    script_text: string;
    position: number;
  }> = [];
  // Running list of generated texts — passed to each LLM call to enforce variety
  const generatedTexts: string[] = [];

  // Pre-count total segment slots for progress reporting
  let totalSegmentSlots = 0;
  for (let i = 0; i < entries.length; i++) {
    totalSegmentSlots += segmentsForEntry(entries[i], entries, i).length;
  }
  // Add shoutout segments (injected after show_intro)
  totalSegmentSlots += pendingShoutouts.length;

  let segmentsDone = 0;

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
        previousSegmentTexts: generatedTexts.slice(-4),
        segmentIndex: position,
      };

      const systemPrompt = buildSystemPrompt(profile);
      const userPrompt = buildUserPrompt(ctx) + rejectionContext;

      console.info(
        `[generationWorker] LLM call — provider=${effectiveLlmProvider} model=${effectiveLlmModel} hasKey=${!!effectiveLlmApiKey} segment=${segment_type}`,
      );

      // Progress: LLM phase spans 10% → 90% (TTS is now manual per-segment)
      const llmProgress = 10 + Math.round((segmentsDone / totalSegmentSlots) * 80);
      await reportProgress(llmProgress, `Writing ${segment_type.replace('_', ' ')} (${segmentsDone + 1}/${totalSegmentSlots})…`);

      let script_text: string;
      try {
        script_text = await llmComplete(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          {
            model: effectiveLlmModel,
            temperature: profile.llm_temperature != null ? Number(profile.llm_temperature) : undefined,
            apiKey: effectiveLlmApiKey ?? undefined,
            provider: effectiveLlmProvider,
          },
        );
      } catch (llmErr) {
        console.error(
          `[generationWorker] LLM call FAILED — provider=${effectiveLlmProvider} model=${effectiveLlmModel} error:`,
          llmErr,
        );
        throw llmErr;
      }

      const pos = position++;
      const segResult = await pool.query(
        `INSERT INTO dj_segments
           (script_id, playlist_entry_id, segment_type, position, script_text)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [script_id, entry.id, segment_type, pos, script_text],
      );

      generatedSegments.push({ id: segResult.rows[0].id, script_text, position: pos });
      generatedTexts.push(script_text);
      segmentsDone++;

      // Inject listener shoutout segments immediately after show_intro
      if (segment_type === 'show_intro' && pendingShoutouts.length > 0) {
        for (const shoutout of pendingShoutouts) {
          const shoutoutProgress = 10 + Math.round((segmentsDone / totalSegmentSlots) * 80);
          await reportProgress(shoutoutProgress, `Writing listener shoutout (${segmentsDone + 1}/${totalSegmentSlots})…`);

          const shoutoutCtx = {
            station_name: station.name,
            station_timezone: station.timezone,
            current_date: currentDate,
            current_hour: entry.hour,
            dj_profile: profile,
            segment_type: 'listener_activity' as DjSegmentType,
            custom_template: templateMap.get('listener_activity'),
            shoutout: {
              listener_name: shoutout.listener_name ?? 'a listener',
              listener_message: shoutout.message,
            },
            previousSegmentTexts: generatedTexts.slice(-4),
            segmentIndex: position,
          };

          const shoutoutSystemPrompt = buildSystemPrompt(profile);
          const shoutoutUserPrompt = buildUserPrompt(shoutoutCtx) + (data.rejection_notes
            ? `\n\nIMPORTANT: The previous script was rejected by the reviewer. Their feedback: "${data.rejection_notes}". Please rewrite accordingly.`
            : '');

          let shoutoutText: string;
          try {
            shoutoutText = await llmComplete(
              [
                { role: 'system', content: shoutoutSystemPrompt },
                { role: 'user', content: shoutoutUserPrompt },
              ],
              {
                model: effectiveLlmModel,
                temperature: profile.llm_temperature != null ? Number(profile.llm_temperature) : undefined,
                apiKey: effectiveLlmApiKey ?? undefined,
                provider: effectiveLlmProvider,
              },
            );
          } catch (llmErr) {
            console.error('[generationWorker] Shoutout LLM call FAILED:', llmErr);
            throw llmErr;
          }

          const shoutoutPos = position++;
          await pool.query(
            `INSERT INTO dj_segments
               (script_id, playlist_entry_id, segment_type, position, script_text)
             VALUES ($1, $2, $3, $4, $5)`,
            [script_id, null, 'listener_activity', shoutoutPos, shoutoutText],
          );

          generatedTexts.push(shoutoutText);
          segmentsDone++;
        }

        // Mark shoutouts as used
        const shoutoutIds = pendingShoutouts.map((s) => s.id);
        await pool.query(
          `UPDATE listener_shoutouts
           SET status = 'used', used_in_script_id = $1, updated_at = NOW()
           WHERE id = ANY($2::uuid[])`,
          [script_id, shoutoutIds],
        );
      }
    }
  }

  // TTS is now generated on demand per-segment via POST /dj/segments/:id/tts
  // (removed from the generation job so scripts are available faster for review)

  await reportProgress(95, 'Finalising…');

  // 8. Update script with final segment count + generation time
  const generation_ms = Date.now() - start;
  await pool.query(
    `UPDATE dj_scripts
     SET total_segments = $2, generation_ms = $3, updated_at = NOW()
     WHERE id = $1`,
    [script_id, position, generation_ms],
  );

  // 9. Build manifest (fire-and-forget — failure does not block script)
  buildManifest(script_id).catch((err) =>
    console.error('[generationWorker] Manifest build failed:', err),
  );

  await reportProgress(100, 'Done');
}
