import { getPool } from '../db.js';
import { llmComplete } from '../adapters/llm/openrouter.js';
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder.js';
import type { DjScript, DjScriptWithSegments, DjSegment, DjProfile, DjSegmentType } from '@playgen/types';

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

/** Approve a single segment — marks it as approved. */
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

/** Update segment text inline and mark as edited. */
export async function updateSegmentText(
  segmentId: string,
  text: string,
): Promise<DjSegment | null> {
  const { rows } = await getPool().query<DjSegment>(
    `UPDATE dj_segments
     SET edited_text = $2, segment_review_status = 'edited', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [segmentId, text],
  );
  return rows[0] ?? null;
}

/**
 * Save edited text for a single segment.
 * Returns the updated segment row or null if not found.
 */
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

/**
 * Inline-regenerate a single segment via LLM using the same profile/context.
 * Returns the updated segment row with the new script_text.
 */
export async function regenerateSegment(
  segmentId: string,
  rejectionNotes?: string,
): Promise<DjSegment | null> {
  const pool = getPool();

  // Load segment with joined context
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
  }>(
    `SELECT
       seg.id, seg.script_id, seg.segment_type, seg.position, seg.playlist_entry_id,
       scr.playlist_id, scr.station_id,
       st.name AS station_name, st.timezone AS station_timezone
     FROM dj_segments seg
     JOIN dj_scripts scr ON scr.id = seg.script_id
     JOIN stations st ON st.id = scr.station_id
     WHERE seg.id = $1`,
    [segmentId],
  );

  const seg = segRows[0];
  if (!seg) return null;

  // Load DJ profile for the script
  const { rows: profileRows } = await pool.query<DjProfile>(
    `SELECT dp.* FROM dj_profiles dp
     JOIN dj_scripts scr ON scr.dj_profile_id = dp.id
     WHERE scr.id = $1`,
    [seg.script_id],
  );
  const profile = profileRows[0];
  if (!profile) return null;

  // Load adjacent songs for context
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

  const myEntryIdx = entryRows.findIndex((e) => e.id === seg.playlist_entry_id);
  const prevEntry = myEntryIdx > 0 ? entryRows[myEntryIdx - 1] : undefined;
  const nextEntry = myEntryIdx >= 0 && myEntryIdx < entryRows.length - 1 ? entryRows[myEntryIdx + 1] : undefined;

  const rejectionContext = rejectionNotes
    ? `\n\nIMPORTANT: The reviewer rejected this segment with the note: "${rejectionNotes}". Please rewrite it accordingly.`
    : '';

  const systemPrompt = buildSystemPrompt(profile);
  const userPrompt = buildUserPrompt({
    station_name: seg.station_name,
    station_timezone: seg.station_timezone,
    current_date: new Date().toISOString().split('T')[0],
    current_hour: myEntryIdx >= 0 ? entryRows[myEntryIdx].hour : 0,
    dj_profile: profile,
    prev_song: prevEntry ? { title: prevEntry.song_title, artist: prevEntry.song_artist, duration_sec: prevEntry.duration_sec } : undefined,
    next_song: nextEntry ? { title: nextEntry.song_title, artist: nextEntry.song_artist, duration_sec: nextEntry.duration_sec } : undefined,
    segment_type: seg.segment_type,
  }) + rejectionContext;

  const newText = await llmComplete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      model: profile.llm_model,
      temperature: profile.llm_temperature,
    },
  );

  const { rows: updated } = await pool.query<DjSegment>(
    `UPDATE dj_segments
     SET script_text = $2, edited_text = NULL, audio_url = NULL,
         audio_duration_sec = NULL, segment_review_status = 'pending', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [segmentId, newText],
  );

  return updated[0] ?? null;
}
