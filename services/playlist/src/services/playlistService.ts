import { getPool } from '../db';
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
  opts: { month?: string } = {}
): Promise<Playlist[]> {
  const pool = getPool();

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
