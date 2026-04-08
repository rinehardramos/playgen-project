import { getPool } from '../db';
import { DEFAULT_ROTATION_RULES } from '@playgen/types';
import type { Playlist } from '@playgen/types';

export interface PlaylistEntry {
  id: string;
  hour: number;
  position: number;
  song_id: string;
  song_title: string;
  song_artist: string;
  category_code: string;
  category_label: string;
  category_color_tag: string | null;
  is_manual_override: boolean;
  overridden_by: string | null;
  overridden_at: string | null;
}

export interface PlaylistWithEntries extends Playlist {
  entries: PlaylistEntry[];
}

export async function listPlaylists(
  stationId: string,
  opts: { month?: string; date?: string } = {}
): Promise<Playlist[]> {
  const pool = getPool();

  if (opts.date) {
    // Validate format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
      throw new Error('date must be in YYYY-MM-DD format');
    }
    const { rows } = await pool.query<Playlist>(
      `SELECT id, station_id, template_id, date, status,
              generated_at, generated_by, approved_at, approved_by, notes
       FROM playlists
       WHERE station_id = $1 AND date = $2
       ORDER BY date`,
      [stationId, opts.date]
    );
    return rows;
  }

  if (opts.month) {
    // Validate format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(opts.month)) {
      throw new Error('month must be in YYYY-MM format');
    }
    const [year, month] = opts.month.split('-').map(Number);
    // First day of month
    const firstDay = `${opts.month}-01`;
    // Last day of month: first day of next month minus 1 day
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const lastDay = new Date(nextYear, nextMonth - 1, 0)
      .toISOString()
      .substring(0, 10);

    const { rows } = await pool.query<Playlist>(
      `SELECT id, station_id, template_id, date, status,
              generated_at, generated_by, approved_at, approved_by, notes
       FROM playlists
       WHERE station_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date`,
      [stationId, firstDay, lastDay]
    );
    return rows;
  }

  const { rows } = await pool.query<Playlist>(
    `SELECT id, station_id, template_id, date, status,
            generated_at, generated_by, approved_at, approved_by, notes
     FROM playlists
     WHERE station_id = $1
     ORDER BY date DESC`,
    [stationId]
  );
  return rows;
}

export async function getPlaylist(id: string): Promise<PlaylistWithEntries | null> {
  const pool = getPool();

  const { rows: playlistRows } = await pool.query<Playlist>(
    `SELECT id, station_id, template_id, date, status,
            generated_at, generated_by, approved_at, approved_by, notes
     FROM playlists
     WHERE id = $1`,
    [id]
  );

  const playlist = playlistRows[0];
  if (!playlist) return null;

  const { rows: entryRows } = await pool.query<PlaylistEntry>(
    `SELECT
       pe.id,
       pe.hour,
       pe.position,
       pe.song_id,
       s.title    AS song_title,
       s.artist   AS song_artist,
       c.code     AS category_code,
       c.label    AS category_label,
       c.color_tag AS category_color_tag,
       pe.is_manual_override,
       pe.overridden_by,
       pe.overridden_at
     FROM playlist_entries pe
     JOIN songs s      ON s.id = pe.song_id
     JOIN categories c ON c.id = s.category_id
     WHERE pe.playlist_id = $1
     ORDER BY pe.hour, pe.position`,
    [id]
  );

  return { ...playlist, entries: entryRows };
}

export async function approvePlaylist(
  id: string,
  userId: string
): Promise<Playlist | null> {
  const pool = getPool();
  const { rows } = await pool.query<Playlist>(
    `UPDATE playlists
     SET status = 'approved', approved_at = NOW(), approved_by = $2
     WHERE id = $1 AND status IN ('ready', 'draft')
     RETURNING id, station_id, template_id, date, status,
               generated_at, generated_by, approved_at, approved_by, notes`,
    [id, userId]
  );
  return rows[0] ?? null;
}

export async function updatePlaylistNotes(
  id: string,
  notes: string
): Promise<Playlist | null> {
  const pool = getPool();
  const { rows } = await pool.query<Playlist>(
    `UPDATE playlists
     SET notes = $2
     WHERE id = $1
     RETURNING id, station_id, template_id, date, status,
               generated_at, generated_by, approved_at, approved_by, notes`,
    [id, notes]
  );
  return rows[0] ?? null;
}

export async function overrideEntry(
  playlistId: string,
  hour: number,
  position: number,
  songId: string,
  userId: string
): Promise<PlaylistEntry> {
  const pool = getPool();

  // Upsert the entry
  await pool.query(
    `INSERT INTO playlist_entries
       (playlist_id, hour, position, song_id, is_manual_override, overridden_by, overridden_at)
     VALUES ($1, $2, $3, $4, TRUE, $5, NOW())
     ON CONFLICT (playlist_id, hour, position) DO UPDATE
       SET song_id           = EXCLUDED.song_id,
           is_manual_override = TRUE,
           overridden_by     = EXCLUDED.overridden_by,
           overridden_at     = EXCLUDED.overridden_at`,
    [playlistId, hour, position, songId, userId]
  );

  // Fetch with joined song/category data
  const { rows } = await pool.query<PlaylistEntry>(
    `SELECT
       pe.id,
       pe.hour,
       pe.position,
       pe.song_id,
       s.title    AS song_title,
       s.artist   AS song_artist,
       c.code     AS category_code,
       c.label    AS category_label,
       c.color_tag AS category_color_tag,
       pe.is_manual_override,
       pe.overridden_by,
       pe.overridden_at
     FROM playlist_entries pe
     JOIN songs s      ON s.id = pe.song_id
     JOIN categories c ON c.id = s.category_id
     WHERE pe.playlist_id = $1 AND pe.hour = $2 AND pe.position = $3`,
    [playlistId, hour, position]
  );

  if (!rows[0]) {
    throw new Error('Entry not found after upsert');
  }
  return rows[0];
}

export async function resetEntry(
  playlistId: string,
  hour: number,
  position: number
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE playlist_entries
     SET is_manual_override = FALSE,
         overridden_by      = NULL,
         overridden_at      = NULL
     WHERE playlist_id = $1 AND hour = $2 AND position = $3`,
    [playlistId, hour, position]
  );
  return (rowCount ?? 0) > 0;
}

// ─── regenEntry ───────────────────────────────────────────────────────────────

/**
 * Re-generate a single playlist slot without touching any other entry.
 * Returns null if playlist or entry not found. Throws if no eligible song found.
 */
export async function regenEntry(
  playlistId: string,
  hour: number,
  position: number,
  _userId: string,
): Promise<PlaylistEntry | null> {
  const pool = getPool();

  // 1. Load playlist
  const { rows: plRows } = await pool.query<{
    station_id: string; date: string; template_id: string | null; status: string;
  }>(
    'SELECT station_id, date, template_id, status FROM playlists WHERE id = $1',
    [playlistId],
  );
  if (!plRows[0]) return null;
  const { station_id: stationId, date, template_id: templateId } = plRows[0];

  // 2. Verify entry exists
  const { rows: existingRows } = await pool.query<{ id: string }>(
    'SELECT id FROM playlist_entries WHERE playlist_id = $1 AND hour = $2 AND position = $3',
    [playlistId, hour, position],
  );
  if (!existingRows[0]) return null;

  // 3. Find required_category_id from template slot or current entry
  let requiredCategoryId: string | null = null;
  if (templateId) {
    const { rows: slotRows } = await pool.query<{ required_category_id: string }>(
      'SELECT required_category_id FROM template_slots WHERE template_id = $1 AND hour = $2 AND position = $3',
      [templateId, hour, position],
    );
    requiredCategoryId = slotRows[0]?.required_category_id ?? null;
  }
  if (!requiredCategoryId) {
    const { rows: curCatRows } = await pool.query<{ category_id: string }>(
      `SELECT s.category_id FROM playlist_entries pe
       JOIN songs s ON s.id = pe.song_id
       WHERE pe.playlist_id = $1 AND pe.hour = $2 AND pe.position = $3`,
      [playlistId, hour, position],
    );
    requiredCategoryId = curCatRows[0]?.category_id ?? null;
  }
  if (!requiredCategoryId) throw new Error('Cannot determine category for this slot');

  // 4. Rotation rules
  const { rows: ruleRows } = await pool.query<{ rules: Record<string, unknown> }>(
    'SELECT rules FROM rotation_rules WHERE station_id = $1',
    [stationId],
  );
  const rules = { ...DEFAULT_ROTATION_RULES, ...(ruleRows[0]?.rules ?? {}) } as {
    max_plays_per_day: number;
    min_gap_hours: number;
    max_same_artist_per_hour: number;
    artist_separation_slots: number;
  };

  // 5. Candidate songs (active, hour-eligible)
  const { rows: candidates } = await pool.query<{ id: string; artist: string }>(
    `SELECT s.id, s.artist
     FROM songs s
     WHERE s.station_id = $1
       AND s.category_id = $2
       AND s.is_active = TRUE
       AND (
         NOT EXISTS (SELECT 1 FROM song_slots ss WHERE ss.song_id = s.id)
         OR EXISTS (SELECT 1 FROM song_slots ss WHERE ss.song_id = s.id AND ss.eligible_hour = $3)
       )`,
    [stationId, requiredCategoryId, hour],
  );
  if (candidates.length === 0) throw new Error(`No songs in category for slot ${hour}:${position}`);

  // 6. Play history (72 h) + today's play counts
  const { rows: historyRows } = await pool.query<{ song_id: string; played_at: Date }>(
    `SELECT song_id, played_at FROM play_history
     WHERE station_id = $1 AND played_at >= NOW() - INTERVAL '72 hours'
     ORDER BY played_at DESC`,
    [stationId],
  );
  const { rows: dayCountRows } = await pool.query<{ song_id: string; plays: string }>(
    `SELECT pe.song_id, COUNT(*)::text AS plays
     FROM playlist_entries pe
     JOIN playlists pl ON pl.id = pe.playlist_id
     WHERE pl.station_id = $1 AND pl.date = $2
     GROUP BY pe.song_id`,
    [stationId, date],
  );
  const dayPlayCounts = new Map<string, number>(dayCountRows.map((r) => [r.song_id, parseInt(r.plays, 10)]));

  // Playlist entries for artist-separation context
  const { rows: allEntries } = await pool.query<{
    song_id: string; artist: string; hour: number; position: number;
  }>(
    `SELECT pe.song_id, s.artist, pe.hour, pe.position
     FROM playlist_entries pe
     JOIN songs s ON s.id = pe.song_id
     WHERE pe.playlist_id = $1
     ORDER BY pe.hour, pe.position`,
    [playlistId],
  );

  const absIdx = allEntries.findIndex((e) => e.hour === hour && e.position === position);
  const placedBefore = absIdx >= 0 ? allEntries.slice(0, absIdx) : allEntries;

  const { rows: curSongRows } = await pool.query<{ song_id: string }>(
    'SELECT song_id FROM playlist_entries WHERE playlist_id = $1 AND hour = $2 AND position = $3',
    [playlistId, hour, position],
  );
  const currentSongId = curSongRows[0]?.song_id;

  // 7. Tiered filter + pick
  const nowMs = Date.now();
  const minGapMs = rules.min_gap_hours * 60 * 60 * 1000;

  function filter(relaxGap: boolean, relaxDay: boolean, allowCurrent: boolean) {
    return candidates.filter((s) => {
      if (!allowCurrent && s.id === currentSongId) return false;
      if (!relaxDay && (dayPlayCounts.get(s.id) ?? 0) >= rules.max_plays_per_day) return false;
      if (!relaxGap) {
        const lp = historyRows.filter((h) => h.song_id === s.id).sort((a, b) => b.played_at.getTime() - a.played_at.getTime())[0];
        if (lp && nowMs - lp.played_at.getTime() < minGapMs) return false;
      }
      const sepStart = Math.max(0, placedBefore.length - rules.artist_separation_slots);
      if (placedBefore.slice(sepStart).some((e) => e.artist.toLowerCase() === s.artist.toLowerCase())) return false;
      if (placedBefore.filter((e) => e.hour === hour && e.artist.toLowerCase() === s.artist.toLowerCase()).length >= rules.max_same_artist_per_hour) return false;
      return true;
    });
  }

  function pickBest(pool_: { id: string; artist: string }[]) {
    if (!pool_.length) return null;
    const lpMap = new Map<string, Date>();
    for (const h of historyRows) {
      const ex = lpMap.get(h.song_id);
      if (!ex || h.played_at > ex) lpMap.set(h.song_id, h.played_at);
    }
    const neverPlayed = pool_.filter((c) => !lpMap.has(c.id));
    if (neverPlayed.length) return neverPlayed[Math.floor(Math.random() * neverPlayed.length)];
    let oldest: Date | null = null;
    for (const c of pool_) { const lp = lpMap.get(c.id); if (lp && (!oldest || lp < oldest)) oldest = lp; }
    const tied = pool_.filter((c) => lpMap.get(c.id)?.getTime() === (oldest as Date).getTime());
    return tied[Math.floor(Math.random() * tied.length)];
  }

  const picked =
    pickBest(filter(false, false, false)) ??
    pickBest(filter(true, false, false)) ??
    pickBest(filter(true, true, false)) ??
    pickBest(filter(true, true, true)) ??
    pickBest(candidates);

  if (!picked) throw new Error(`No eligible songs for slot ${hour}:${position} after full relaxation`);

  // 8. Update entry
  await pool.query(
    `UPDATE playlist_entries SET song_id = $1, is_manual_override = FALSE, overridden_by = NULL, overridden_at = NULL
     WHERE playlist_id = $2 AND hour = $3 AND position = $4`,
    [picked.id, playlistId, hour, position],
  );

  const { rows: result } = await pool.query<PlaylistEntry>(
    `SELECT pe.id, pe.hour, pe.position, pe.song_id,
       s.title AS song_title, s.artist AS song_artist,
       c.code AS category_code, c.label AS category_label, c.color_tag AS category_color_tag,
       pe.is_manual_override, pe.overridden_by, pe.overridden_at
     FROM playlist_entries pe
     JOIN songs s ON s.id = pe.song_id
     JOIN categories c ON c.id = s.category_id
     WHERE pe.playlist_id = $1 AND pe.hour = $2 AND pe.position = $3`,
    [playlistId, hour, position],
  );
  return result[0] ?? null;
}
