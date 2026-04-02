import { getPool } from '../db';

// ─── Return types ─────────────────────────────────────────────────────────────

export interface HeatmapRow {
  song_id: string;
  title: string;
  artist: string;
  category_code: string;
  plays: Record<string, number>;
}

export interface OverplayedRow {
  song_id: string;
  title: string;
  artist: string;
  category_code: string;
  avg_plays_per_day: number;
  threshold: number;
}

export interface UnderplayedRow {
  song_id: string;
  title: string;
  artist: string;
  category_code: string;
  total_plays: number;
  last_played_at: string | null;
}

export interface CategoryDistributionRow {
  category_code: string;
  category_label: string;
  total_plays: number;
  percentage: number;
}

export interface SongHistoryRow {
  played_at: string;
  playlist_id: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Load the station's max_plays_per_day from rotation_rules, falling back to 2. */
async function getMaxPlaysPerDay(stationId: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ rules: unknown }>(
    'SELECT rules FROM rotation_rules WHERE station_id = $1',
    [stationId],
  );
  const ruleRow = result.rows[0];
  const rules = (ruleRow?.rules as Record<string, unknown>) ?? {};
  return Number(rules.max_plays_per_day ?? 2);
}

// ─── getRotationHeatmap ───────────────────────────────────────────────────────

/**
 * Returns per-song daily play counts over the past `days` days for a station.
 * `plays` is a map of 'YYYY-MM-DD' → count.
 */
export async function getRotationHeatmap(
  stationId: string,
  days = 14,
): Promise<HeatmapRow[]> {
  const pool = getPool();

  const sql = `
    SELECT
      s.id                                       AS song_id,
      s.title,
      s.artist,
      COALESCE(c.code, '')                       AS category_code,
      TO_CHAR(ph.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS play_date,
      COUNT(*)::int                              AS play_count
    FROM play_history ph
    JOIN songs      s ON s.id = ph.song_id
    LEFT JOIN categories c ON c.id = s.category_id
    WHERE ph.station_id = $1
      AND ph.played_at  >= NOW() - ($2 || ' days')::INTERVAL
    GROUP BY s.id, s.title, s.artist, c.code, play_date
    ORDER BY s.title, play_date
  `;

  const { rows } = await pool.query<{
    song_id: string;
    title: string;
    artist: string;
    category_code: string;
    play_date: string;
    play_count: number;
  }>(sql, [stationId, days]);

  // Aggregate into per-song HeatmapRow objects
  const songMap = new Map<string, HeatmapRow>();
  for (const row of rows) {
    let entry = songMap.get(row.song_id);
    if (!entry) {
      entry = {
        song_id: row.song_id,
        title: row.title,
        artist: row.artist,
        category_code: row.category_code,
        plays: {},
      };
      songMap.set(row.song_id, entry);
    }
    entry.plays[row.play_date] = row.play_count;
  }

  return Array.from(songMap.values());
}

// ─── getOverplayedSongs ───────────────────────────────────────────────────────

/**
 * Returns songs whose average daily plays over the past 14 days exceed the
 * station's configured max_plays_per_day threshold.
 */
export async function getOverplayedSongs(stationId: string): Promise<OverplayedRow[]> {
  const [threshold, pool] = await Promise.all([
    getMaxPlaysPerDay(stationId),
    Promise.resolve(getPool()),
  ]);

  const sql = `
    SELECT
      s.id                              AS song_id,
      s.title,
      s.artist,
      COALESCE(c.code, '')              AS category_code,
      ROUND(
        COUNT(*)::numeric / 14,
        2
      )                                 AS avg_plays_per_day
    FROM play_history ph
    JOIN songs      s ON s.id = ph.song_id
    LEFT JOIN categories c ON c.id = s.category_id
    WHERE ph.station_id = $1
      AND ph.played_at  >= NOW() - INTERVAL '14 days'
    GROUP BY s.id, s.title, s.artist, c.code
    HAVING COUNT(*)::numeric / 14 > $2
    ORDER BY avg_plays_per_day DESC
  `;

  const { rows } = await pool.query<{
    song_id: string;
    title: string;
    artist: string;
    category_code: string;
    avg_plays_per_day: string;
  }>(sql, [stationId, threshold]);

  return rows.map((r) => ({
    song_id: r.song_id,
    title: r.title,
    artist: r.artist,
    category_code: r.category_code,
    avg_plays_per_day: Number(r.avg_plays_per_day),
    threshold,
  }));
}

// ─── getUnderplayedSongs ──────────────────────────────────────────────────────

/**
 * Returns active songs played fewer than 3 times in the past 14 days
 * (including songs with zero plays in that window).
 */
export async function getUnderplayedSongs(stationId: string): Promise<UnderplayedRow[]> {
  const pool = getPool();

  const sql = `
    SELECT
      s.id                              AS song_id,
      s.title,
      s.artist,
      COALESCE(c.code, '')              AS category_code,
      COUNT(ph.id)::int                 AS total_plays,
      MAX(ph.played_at)                 AS last_played_at
    FROM songs s
    LEFT JOIN categories c ON c.id = s.category_id
    LEFT JOIN play_history ph
           ON ph.song_id   = s.id
          AND ph.station_id = $1
          AND ph.played_at >= NOW() - INTERVAL '14 days'
    WHERE s.station_id = $1
      AND s.is_active   = TRUE
    GROUP BY s.id, s.title, s.artist, c.code
    HAVING COUNT(ph.id) < 3
    ORDER BY total_plays ASC, s.title
  `;

  const { rows } = await pool.query<{
    song_id: string;
    title: string;
    artist: string;
    category_code: string;
    total_plays: number;
    last_played_at: Date | null;
  }>(sql, [stationId]);

  return rows.map((r) => ({
    song_id: r.song_id,
    title: r.title,
    artist: r.artist,
    category_code: r.category_code,
    total_plays: r.total_plays,
    last_played_at: r.last_played_at ? r.last_played_at.toISOString() : null,
  }));
}

// ─── getCategoryDistribution ──────────────────────────────────────────────────

/**
 * Returns the percentage breakdown of plays by category over the past `days` days.
 */
export async function getCategoryDistribution(
  stationId: string,
  days = 7,
): Promise<CategoryDistributionRow[]> {
  const pool = getPool();

  const sql = `
    WITH play_counts AS (
      SELECT
        COALESCE(c.code,  'UNCATEGORISED') AS category_code,
        COALESCE(c.label, 'Uncategorised') AS category_label,
        COUNT(*)::int                      AS total_plays
      FROM play_history ph
      JOIN songs      s ON s.id = ph.song_id
      LEFT JOIN categories c ON c.id = s.category_id
      WHERE ph.station_id = $1
        AND ph.played_at  >= NOW() - ($2 || ' days')::INTERVAL
      GROUP BY c.code, c.label
    ),
    grand_total AS (
      SELECT SUM(total_plays) AS grand FROM play_counts
    )
    SELECT
      pc.category_code,
      pc.category_label,
      pc.total_plays,
      CASE
        WHEN gt.grand = 0 THEN 0
        ELSE ROUND(pc.total_plays::numeric * 100 / gt.grand, 2)
      END AS percentage
    FROM play_counts pc
    CROSS JOIN grand_total gt
    ORDER BY pc.total_plays DESC
  `;

  const { rows } = await pool.query<{
    category_code: string;
    category_label: string;
    total_plays: number;
    percentage: string;
  }>(sql, [stationId, days]);

  return rows.map((r) => ({
    category_code: r.category_code,
    category_label: r.category_label,
    total_plays: r.total_plays,
    percentage: Number(r.percentage),
  }));
}

// ─── getSongHistory ───────────────────────────────────────────────────────────

/**
 * Returns recent play_history entries for a single song.
 */
export async function getSongHistory(
  songId: string,
  limit = 30,
): Promise<SongHistoryRow[]> {
  const pool = getPool();

  const sql = `
    SELECT
      played_at,
      playlist_id
    FROM play_history
    WHERE song_id = $1
    ORDER BY played_at DESC
    LIMIT $2
  `;

  const { rows } = await pool.query<{
    played_at: Date;
    playlist_id: string | null;
  }>(sql, [songId, limit]);

  return rows.map((r) => ({
    played_at: r.played_at.toISOString(),
    playlist_id: r.playlist_id,
  }));
}
