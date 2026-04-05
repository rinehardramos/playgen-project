import { getPool } from '../db.js';
import type { DjScript, DjScriptWithSegments, DjSegment, DjSegmentType, DjProfile } from '@playgen/types';
import { llmComplete } from '../adapters/llm/index.js';
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder.js';
import { config } from '../config.js';

export async function getScript(playlist_id: string): Promise<DjScriptWithSegments | null> {
  const pool = getPool();

  const { rows: scripts } = await pool.query<DjScript>(
    `SELECT * FROM dj_scripts WHERE playlist_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [playlist_id],
  );
  if (!scripts[0]) return null;

  const script = scripts[0];
  const { rows: segments } = await pool.query<DjSegment>(
    `SELECT * FROM dj_segments WHERE script_id = $1 ORDER BY position`,
    [script.id],
  );

  return { ...script, segments };
}

export async function getScriptById(id: string): Promise<DjScriptWithSegments | null> {
  const pool = getPool();

  const { rows: scripts } = await pool.query<DjScript>(
    `SELECT * FROM dj_scripts WHERE id = $1`,
    [id],
  );
  if (!scripts[0]) return null;

  const { rows: segments } = await pool.query<DjSegment>(
    `SELECT * FROM dj_segments WHERE script_id = $1 ORDER BY position`,
    [id],
  );

  return { ...scripts[0], segments };
}

export async function approveScript(
  id: string,
  reviewed_by: string,
  review_notes?: string,
): Promise<DjScript | null> {
  const { rows } = await getPool().query<DjScript>(
    `UPDATE dj_scripts
     SET review_status = 'approved',
         reviewed_by = $2,
         reviewed_at = NOW(),
         review_notes = $3,
         updated_at = NOW()
     WHERE id = $1 AND review_status = 'pending_review'
     RETURNING *`,
    [id, reviewed_by, review_notes ?? null],
  );
  return rows[0] ?? null;
}

export async function rejectScript(
  id: string,
  reviewed_by: string,
  review_notes: string,
): Promise<DjScript | null> {
  const { rows } = await getPool().query<DjScript>(
    `UPDATE dj_scripts
     SET review_status = 'rejected',
         reviewed_by = $2,
         reviewed_at = NOW(),
         review_notes = $3,
         updated_at = NOW()
     WHERE id = $1 AND review_status IN ('pending_review', 'approved')
     RETURNING *`,
    [id, reviewed_by, review_notes],
  );
  return rows[0] ?? null;
}

export async function editSegments(
  script_id: string,
  edits: Array<{ id: string; edited_text: string }>,
): Promise<void> {
  const pool = getPool();
  await Promise.all(
    edits.map(({ id, edited_text }) =>
      pool.query(
        `UPDATE dj_segments
         SET edited_text = $2, segment_review_status = 'edited', updated_at = NOW()
         WHERE id = $1 AND script_id = $3`,
        [id, edited_text, script_id],
      ),
    ),
  );
}

/** Save inline-edited text for a single segment — marks it as 'edited'. */
export async function saveSegmentEdit(
  segmentId: string,
  editedText: string,
): Promise<DjSegment | null> {
  const { rows } = await getPool().query<DjSegment>(
    `UPDATE dj_segments
     SET edited_text = $2, segment_review_status = 'edited', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [segmentId, editedText],
  );
  return rows[0] ?? null;
}

/** Mark a single segment as approved. */
export async function approveSegment(segmentId: string): Promise<DjSegment | null> {
  const { rows } = await getPool().query<DjSegment>(
    `UPDATE dj_segments
     SET segment_review_status = 'approved', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [segmentId],
  );
  return rows[0] ?? null;
}

/**
 * Inline-regenerate a single segment via LLM and return the updated segment.
 * The segment is reset to 'pending' so the user can review the new version.
 */
export async function regenerateSegment(
  segmentId: string,
  rejectionNotes?: string,
): Promise<DjSegment | null> {
  const pool = getPool();

  // Load segment with joined context (including station API key columns for LLM resolution)
  const { rows: segRows } = await pool.query<{
    id: string;
    script_id: string;
    segment_type: DjSegmentType;
    position: number;
    playlist_entry_id: string | null;
    playlist_id: string;
    station_id: string;
    station_name: string;
    station_timezone: string;
    openrouter_api_key: string | null;
    openai_api_key: string | null;
    anthropic_api_key: string | null;
    gemini_api_key: string | null;
    mistral_api_key: string | null;
  }>(
    `SELECT
       seg.id, seg.script_id, seg.segment_type, seg.position, seg.playlist_entry_id,
       scr.playlist_id, scr.station_id,
       st.name AS station_name, st.timezone AS station_timezone,
       st.openrouter_api_key, st.openai_api_key, st.anthropic_api_key,
       st.gemini_api_key, st.mistral_api_key
     FROM dj_segments seg
     JOIN dj_scripts scr ON scr.id = seg.script_id
     JOIN stations st ON st.id = scr.station_id
     WHERE seg.id = $1`,
    [segmentId],
  );
  const seg = segRows[0];
  if (!seg) return null;

  // Load DJ profile
  const { rows: profileRows } = await pool.query<DjProfile>(
    `SELECT dp.* FROM dj_profiles dp
     JOIN dj_scripts scr ON scr.dj_profile_id = dp.id
     WHERE scr.id = $1`,
    [seg.script_id],
  );
  const profile = profileRows[0];
  if (!profile) return null;

  // Load per-station settings to resolve effective LLM provider / API key
  const { rows: settingRows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM station_settings WHERE station_id = $1`,
    [seg.station_id],
  );
  const stationSettings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));

  const effectiveLlmProvider = stationSettings['llm_provider'] ?? config.llm.provider;
  const effectiveLlmModel = stationSettings['llm_model'] || profile.llm_model;
  const effectiveLlmApiKey =
    stationSettings['llm_api_key'] ??
    (effectiveLlmProvider === 'anthropic'
      ? seg.anthropic_api_key
      : effectiveLlmProvider === 'gemini'
      ? seg.gemini_api_key
      : effectiveLlmProvider === 'openai'
      ? seg.openai_api_key
      : effectiveLlmProvider === 'mistral'
      ? seg.mistral_api_key
      : seg.openrouter_api_key) ??
    undefined;

  // Pre-flight: ensure we have a usable LLM API key before calling the LLM.
  const globalLlmFallback =
    effectiveLlmProvider === 'openai'
      ? config.llm.openaiApiKey
      : effectiveLlmProvider === 'anthropic'
      ? config.llm.anthropicApiKey
      : config.openRouter.apiKey;
  if (!effectiveLlmApiKey && !globalLlmFallback) {
    throw new Error(
      `No LLM API key configured for provider "${effectiveLlmProvider}". ` +
      `Set OPENROUTER_API_KEY (or the relevant key) in Railway environment variables, ` +
      `or add a per-station API key in Station Settings → DJ Settings.`,
    );
  }

  // Load playlist entries for context
  const { rows: entryRows } = await pool.query<{
    id: string; hour: number; position: number;
    song_title: string; song_artist: string; duration_sec: number | null;
  }>(
    `SELECT pe.id, pe.hour, pe.position,
            s.title AS song_title, s.artist AS song_artist, s.duration_sec
     FROM playlist_entries pe
     JOIN songs s ON s.id = pe.song_id
     WHERE pe.playlist_id = $1
     ORDER BY pe.hour, pe.position`,
    [seg.playlist_id],
  );

  const myIdx = entryRows.findIndex((e) => e.id === seg.playlist_entry_id);
  const prevEntry = myIdx > 0 ? entryRows[myIdx - 1] : undefined;
  const nextEntry = myIdx >= 0 && myIdx < entryRows.length - 1 ? entryRows[myIdx + 1] : undefined;

  const rejectionContext = rejectionNotes
    ? `\n\nIMPORTANT: The reviewer rejected this segment with the note: "${rejectionNotes}". Please rewrite it accordingly.`
    : '';

  const systemPrompt = buildSystemPrompt(profile);
  const userPrompt =
    buildUserPrompt({
      station_name: seg.station_name,
      station_timezone: seg.station_timezone,
      current_date: new Date().toISOString().split('T')[0],
      current_hour: myIdx >= 0 ? entryRows[myIdx].hour : 0,
      dj_profile: profile,
      prev_song: prevEntry
        ? { title: prevEntry.song_title, artist: prevEntry.song_artist, duration_sec: prevEntry.duration_sec }
        : undefined,
      next_song: nextEntry
        ? { title: nextEntry.song_title, artist: nextEntry.song_artist, duration_sec: nextEntry.duration_sec }
        : undefined,
      segment_type: seg.segment_type,
    }) + rejectionContext;

  const newText = await llmComplete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      model: effectiveLlmModel,
      temperature: profile.llm_temperature != null ? Number(profile.llm_temperature) : undefined,
      apiKey: effectiveLlmApiKey,
      provider: effectiveLlmProvider,
    },
  );

  // Update segment with new text, reset to pending for review; store rejection_notes for audit
  const { rows: updated } = await pool.query<DjSegment>(
    `UPDATE dj_segments
     SET script_text = $2, edited_text = NULL, segment_review_status = 'pending',
         rejection_notes = $3, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [segmentId, newText.trim(), rejectionNotes ?? null],
  );
  return updated[0] ?? null;
}
