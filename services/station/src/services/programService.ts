import { getPool } from '../db';
import type { Program, ShowFormatClock, ShowClockSlot, ProgramEpisode } from '@playgen/types';

// ─── Programs ────────────────────────────────────────────────────────────────

export async function listPrograms(stationId: string): Promise<Program[]> {
  const { rows } = await getPool().query<Program>(
    'SELECT * FROM programs WHERE station_id = $1 ORDER BY is_default ASC, name ASC',
    [stationId]
  );
  return rows;
}

export async function getProgram(id: string): Promise<Program | null> {
  const { rows } = await getPool().query<Program>(
    'SELECT * FROM programs WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function createProgram(data: {
  station_id: string;
  name: string;
  description?: string;
  active_days?: string[];
  start_hour?: number;
  end_hour?: number;
  template_id?: string | null;
  color_tag?: string | null;
  themes?: unknown[] | null;
}): Promise<Program> {
  const { rows } = await getPool().query<Program>(
    `INSERT INTO programs
       (station_id, name, description, active_days, start_hour, end_hour, template_id, color_tag, themes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.station_id,
      data.name,
      data.description ?? null,
      // Normalize to lowercase full names to match getDayOfWeek() in generationEngine
      (data.active_days ?? []).map(d => {
        const map: Record<string, string> = {
          MON: 'monday', TUE: 'tuesday', WED: 'wednesday', THU: 'thursday',
          FRI: 'friday', SAT: 'saturday', SUN: 'sunday',
        };
        return map[d.toUpperCase()] ?? d.toLowerCase();
      }),
      data.start_hour ?? 0,
      data.end_hour ?? 24,
      data.template_id ?? null,
      data.color_tag ?? null,
      JSON.stringify(data.themes ?? []),
    ]
  );
  return rows[0];
}

export async function updateProgram(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    active_days: string[];
    start_hour: number;
    end_hour: number;
    template_id: string | null;
    color_tag: string | null;
    dj_profile_id: string | null;
    is_active: boolean;
    themes: unknown[] | null;
  }>
): Promise<Program | null> {
  const allowed = ['name', 'description', 'active_days', 'start_hour', 'end_hour', 'template_id', 'color_tag', 'dj_profile_id', 'is_active', 'themes'] as const;
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      // JSONB fields need JSON.stringify
      const val = key === 'themes' ? JSON.stringify(data[key]) : data[key];
      fields.push(`${key} = $${i++}`);
      values.push(val);
    }
  }
  if (!fields.length) return getProgram(id);
  fields.push('updated_at = NOW()');
  values.push(id);
  const { rows } = await getPool().query<Program>(
    `UPDATE programs SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteProgram(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'DELETE FROM programs WHERE id = $1 AND is_default = FALSE',
    [id]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Show Format Clocks ───────────────────────────────────────────────────────

export async function listClocks(programId: string): Promise<ShowFormatClock[]> {
  const { rows } = await getPool().query<ShowFormatClock>(
    'SELECT * FROM show_format_clocks WHERE program_id = $1 ORDER BY is_default DESC, name ASC',
    [programId]
  );
  return rows;
}

export async function getClock(id: string): Promise<ShowFormatClock | null> {
  const { rows } = await getPool().query<ShowFormatClock>(
    'SELECT * FROM show_format_clocks WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function createClock(data: {
  program_id: string;
  name?: string;
  applies_to_hours?: number[] | null;
  is_default?: boolean;
}): Promise<ShowFormatClock> {
  const { rows } = await getPool().query<ShowFormatClock>(
    `INSERT INTO show_format_clocks (program_id, name, applies_to_hours, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      data.program_id,
      data.name ?? 'Standard Hour',
      data.applies_to_hours ?? null,
      data.is_default ?? false,
    ]
  );
  return rows[0];
}

export async function updateClock(
  id: string,
  data: Partial<{ name: string; applies_to_hours: number[] | null; is_default: boolean }>
): Promise<ShowFormatClock | null> {
  const allowed = ['name', 'applies_to_hours', 'is_default'] as const;
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = $${i++}`);
      values.push(data[key]);
    }
  }
  if (!fields.length) return getClock(id);
  fields.push('updated_at = NOW()');
  values.push(id);
  const { rows } = await getPool().query<ShowFormatClock>(
    `UPDATE show_format_clocks SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteClock(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'DELETE FROM show_format_clocks WHERE id = $1',
    [id]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Show Clock Slots ─────────────────────────────────────────────────────────

export async function listClockSlots(clockId: string): Promise<ShowClockSlot[]> {
  const { rows } = await getPool().query<ShowClockSlot>(
    'SELECT * FROM show_clock_slots WHERE clock_id = $1 ORDER BY position ASC',
    [clockId]
  );
  return rows;
}

export async function upsertClockSlots(
  clockId: string,
  slots: Array<Omit<ShowClockSlot, 'id' | 'clock_id'>>
): Promise<ShowClockSlot[]> {
  const pool = getPool();
  // Replace all slots for this clock atomically
  await pool.query('DELETE FROM show_clock_slots WHERE clock_id = $1', [clockId]);
  if (!slots.length) return [];
  const rows: ShowClockSlot[] = [];
  for (const slot of slots) {
    const { rows: inserted } = await pool.query<ShowClockSlot>(
      `INSERT INTO show_clock_slots
         (clock_id, position, content_type, category_id, segment_type, target_minute, duration_est_sec, is_required, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        clockId,
        slot.position,
        slot.content_type,
        slot.category_id ?? null,
        slot.segment_type ?? null,
        slot.target_minute ?? null,
        slot.duration_est_sec ?? null,
        slot.is_required ?? true,
        slot.notes ?? null,
      ]
    );
    rows.push(inserted[0]);
  }
  return rows;
}

// ─── Program Episodes ─────────────────────────────────────────────────────────

export async function listEpisodes(
  programId: string,
  month?: string   // 'YYYY-MM' filter
): Promise<ProgramEpisode[]> {
  const base = 'SELECT * FROM program_episodes WHERE program_id = $1';
  if (month) {
    const { rows } = await getPool().query<ProgramEpisode>(
      `${base} AND to_char(air_date, 'YYYY-MM') = $2 ORDER BY air_date ASC`,
      [programId, month]
    );
    return rows;
  }
  const { rows } = await getPool().query<ProgramEpisode>(
    `${base} ORDER BY air_date DESC LIMIT 100`,
    [programId]
  );
  return rows;
}

export async function getEpisode(id: string): Promise<ProgramEpisode | null> {
  const { rows } = await getPool().query<ProgramEpisode>(
    'SELECT * FROM program_episodes WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function getEpisodeByPlaylist(playlistId: string): Promise<ProgramEpisode | null> {
  const { rows } = await getPool().query<ProgramEpisode>(
    'SELECT * FROM program_episodes WHERE playlist_id = $1',
    [playlistId]
  );
  return rows[0] ?? null;
}

export async function updateEpisode(
  id: string,
  data: Partial<{ episode_title: string | null; notes: string | null }>
): Promise<ProgramEpisode | null> {
  const allowed = ['episode_title', 'notes'] as const;
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = $${i++}`);
      values.push(data[key]);
    }
  }
  if (!fields.length) return getEpisode(id);
  fields.push('updated_at = NOW()');
  values.push(id);
  const { rows } = await getPool().query<ProgramEpisode>(
    `UPDATE program_episodes SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

export interface PublishValidation {
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

/** Validate whether an episode is ready for publishing. */
export async function validatePublishReadiness(id: string): Promise<PublishValidation> {
  const pool = getPool();
  const blockers: string[] = [];
  const warnings: string[] = [];

  const { rows: [episode] } = await pool.query(
    `SELECT pe.*, p.name AS program_name
     FROM program_episodes pe
     JOIN programs p ON p.id = pe.program_id
     WHERE pe.id = $1`,
    [id],
  );
  if (!episode) return { ready: false, blockers: ['Episode not found'], warnings: [] };

  // Check playlist exists
  if (!episode.playlist_id) {
    blockers.push('No playlist linked to this episode');
  } else {
    // Check playlist status
    const { rows: [playlist] } = await pool.query(
      `SELECT status FROM playlists WHERE id = $1`,
      [episode.playlist_id],
    );
    if (!playlist) {
      blockers.push('Linked playlist not found');
    } else if (playlist.status !== 'approved' && playlist.status !== 'ready') {
      blockers.push(`Playlist status is "${playlist.status}" — must be approved or ready`);
    }

    // Check songs have audio
    const { rows: [audioCheck] } = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(s.audio_url) AS with_audio
       FROM playlist_entries pe
       JOIN songs s ON s.id = pe.song_id
       WHERE pe.playlist_id = $1`,
      [episode.playlist_id],
    );
    const missing = parseInt(audioCheck.total) - parseInt(audioCheck.with_audio);
    if (missing > 0) {
      blockers.push(`${missing} song(s) missing audio files`);
    }
  }

  // Check DJ script
  if (!episode.dj_script_id) {
    warnings.push('No DJ script linked — episode will publish without DJ segments');
  } else {
    const { rows: [script] } = await pool.query(
      `SELECT review_status FROM dj_scripts WHERE id = $1`,
      [episode.dj_script_id],
    );
    if (script && script.review_status !== 'approved' && script.review_status !== 'auto_approved') {
      blockers.push(`DJ script review status is "${script.review_status}" — must be approved`);
    }
  }

  return { ready: blockers.length === 0, blockers, warnings };
}

/**
 * Enhanced publish: validates readiness, builds manifest, sets published status.
 * Returns the episode + validation result + manifest URL.
 */
export async function publishEpisode(
  id: string,
  userId: string,
  opts: { force?: boolean } = {},
): Promise<{ episode: ProgramEpisode | null; validation: PublishValidation; manifest_url?: string }> {
  const validation = await validatePublishReadiness(id);

  if (!validation.ready && !opts.force) {
    return { episode: null, validation };
  }

  // Build manifest if DJ script exists
  let manifestUrl: string | undefined;
  const { rows: [ep] } = await getPool().query(
    `SELECT dj_script_id FROM program_episodes WHERE id = $1`,
    [id],
  );
  if (ep?.dj_script_id) {
    try {
      // Dynamic import to avoid circular dependency with dj-service
      // In production, this calls the DJ service via HTTP; for now we build inline
      const { buildProgramManifest } = await import('./manifestBridge');
      const manifest = await buildProgramManifest(id);
      manifestUrl = manifest?.manifest_url ?? undefined;
    } catch (err) {
      validation.warnings.push(`Manifest build failed: ${(err as Error).message}`);
    }
  }

  // Update episode
  const { rows } = await getPool().query<ProgramEpisode>(
    `UPDATE program_episodes
     SET published_at = NOW(), published_by = $2, status = 'aired', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, userId],
  );

  return { episode: rows[0] ?? null, validation, manifest_url: manifestUrl };
}
