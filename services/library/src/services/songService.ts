import { getPool } from '../db';
import { Song, SongWithSlots, PaginatedResponse } from '@playgen/types';

interface SongRow extends Song {
  eligible_hours: number[] | null;
}

export async function listSongs(
  stationId: string,
  opts: {
    category_id?: string;
    search?: string;
    is_active?: boolean;
    page?: number;
    limit?: number;
  }
): Promise<PaginatedResponse<SongWithSlots>> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['s.station_id = $1'];
  const values: unknown[] = [stationId];
  let i = 2;

  if (opts.category_id) { conditions.push(`s.category_id = $${i++}`); values.push(opts.category_id); }
  if (opts.is_active !== undefined) { conditions.push(`s.is_active = $${i++}`); values.push(opts.is_active); }
  if (opts.search) {
    conditions.push(`(s.title ILIKE $${i} OR s.artist ILIKE $${i})`);
    values.push(`%${opts.search}%`);
    i++;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [{ rows: data }, { rows: countRows }] = await Promise.all([
    getPool().query<SongRow>(
      `SELECT s.*,
              ARRAY_REMOVE(ARRAY_AGG(ss.eligible_hour ORDER BY ss.eligible_hour), NULL) AS eligible_hours
       FROM songs s
       LEFT JOIN song_slots ss ON ss.song_id = s.id
       ${where}
       GROUP BY s.id
       ORDER BY s.artist, s.title
       LIMIT $${i} OFFSET $${i + 1}`,
      [...values, limit, offset]
    ),
    getPool().query<{ count: string }>(
      `SELECT COUNT(*) FROM songs s ${where}`,
      values
    ),
  ]);

  const total = parseInt(countRows[0].count, 10);
  return {
    data: data.map(r => ({ ...r, eligible_hours: r.eligible_hours ?? [] })),
    meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function getSong(id: string): Promise<SongWithSlots | null> {
  const { rows } = await getPool().query<SongRow>(
    `SELECT s.*,
            ARRAY_REMOVE(ARRAY_AGG(ss.eligible_hour ORDER BY ss.eligible_hour), NULL) AS eligible_hours
     FROM songs s
     LEFT JOIN song_slots ss ON ss.song_id = s.id
     WHERE s.id = $1
     GROUP BY s.id`,
    [id]
  );
  if (!rows[0]) return null;
  return { ...rows[0], eligible_hours: rows[0].eligible_hours ?? [] };
}

export async function createSong(data: {
  company_id: string;
  station_id: string;
  category_id: string;
  title: string;
  artist: string;
  duration_sec?: number;
  eligible_hours?: number[];
  raw_material?: string;
}): Promise<SongWithSlots> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<Song>(
      `INSERT INTO songs (company_id, station_id, category_id, title, artist, duration_sec, raw_material)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.company_id, data.station_id, data.category_id, data.title, data.artist, data.duration_sec ?? null, data.raw_material ?? null]
    );
    const song = rows[0];
    if (data.eligible_hours?.length) {
      await client.query(
        `INSERT INTO song_slots (song_id, eligible_hour)
         SELECT $1, UNNEST($2::smallint[])
         ON CONFLICT DO NOTHING`,
        [song.id, data.eligible_hours]
      );
    }
    await client.query('COMMIT');
    return { ...song, eligible_hours: data.eligible_hours ?? [] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateSong(id: string, data: Partial<{
  category_id: string;
  title: string;
  artist: string;
  duration_sec: number;
  is_active: boolean;
  eligible_hours: number[];
}>): Promise<SongWithSlots | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const allowed = ['category_id', 'title', 'artist', 'duration_sec', 'is_active'] as const;
    for (const key of allowed) {
      if (data[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length) {
      fields.push('updated_at = NOW()');
      values.push(id);
      await client.query(`UPDATE songs SET ${fields.join(', ')} WHERE id = $${i}`, values);
    }

    if (data.eligible_hours !== undefined) {
      await client.query('DELETE FROM song_slots WHERE song_id = $1', [id]);
      if (data.eligible_hours.length) {
        await client.query(
          `INSERT INTO song_slots (song_id, eligible_hour)
           SELECT $1, UNNEST($2::smallint[])`,
          [id, data.eligible_hours]
        );
      }
    }

    await client.query('COMMIT');
    return getSong(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deactivateSong(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'UPDATE songs SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
    [id]
  );
  return (rowCount ?? 0) > 0;
}

export async function bulkCreateSongs(songs: Array<Parameters<typeof createSong>[0]>): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const song of songs) {
    try {
      await createSong(song);
      created++;
    } catch (err: unknown) {
      // Skip duplicates (same title + artist + station already exists)
      if ((err as NodeJS.ErrnoException).code === '23505') { skipped++; continue; }
      throw err;
    }
  }
  return { created, skipped };
}
