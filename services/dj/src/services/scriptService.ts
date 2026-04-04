import { getPool } from '../db.js';
import type { DjScript, DjScriptWithSegments, DjSegment } from '@playgen/types';

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
        `UPDATE dj_segments SET edited_text = $2, updated_at = NOW()
         WHERE id = $1 AND script_id = $3`,
        [id, edited_text, script_id],
      ),
    ),
  );
}
