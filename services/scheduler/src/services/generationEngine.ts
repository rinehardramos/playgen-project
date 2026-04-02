import { Pool, PoolClient } from 'pg';
import { DEFAULT_ROTATION_RULES } from '@playgen/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RotationRules {
  max_plays_per_day: number;
  min_gap_hours: number;
  max_same_artist_per_hour: number;
  artist_separation_slots: number;
  category_weights: Record<string, number>;
}

interface TemplateSlot {
  id: string;
  template_id: string;
  hour: number;
  position: number;
  required_category_id: string;
  category_code: string;
}

interface CandidateSong {
  id: string;
  artist: string;
}

interface PlayHistoryEntry {
  song_id: string;
  played_at: Date;
}

interface DayPlayCount {
  song_id: string;
  plays: number;
}

interface PlacedEntry {
  hour: number;
  position: number;
  song_id: string;
  artist: string;
}

interface ManualOverride {
  hour: number;
  position: number;
  song_id: string;
}

export interface GeneratePlaylistParams {
  stationId: string;
  date: string; // 'YYYY-MM-DD'
  templateId?: string;
  triggeredBy: 'manual' | 'cron';
  userId?: string;
}

export interface GeneratePlaylistResult {
  playlistId: string;
  entriesCount: number;
}

// ─── Pool singleton (self-contained, no shared/db import) ────────────────────

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'playgen',
      user: process.env.POSTGRES_USER ?? 'playgen',
      password: process.env.POSTGRES_PASSWORD ?? 'changeme',
      max: 10,
    });
    _pool.on('error', (err) => console.error('pg pool error (generationEngine)', err));
  }
  return _pool;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Pick the best candidate song for a slot.
 * Returns null if candidates array is empty.
 */
export function pickBestCandidate(
  candidates: CandidateSong[],
  recentHistory: PlayHistoryEntry[],
): CandidateSong | null {
  if (candidates.length === 0) return null;

  // Build a map of song_id -> most recent played_at
  const lastPlayed = new Map<string, Date>();
  for (const entry of recentHistory) {
    const existing = lastPlayed.get(entry.song_id);
    if (!existing || entry.played_at > existing) {
      lastPlayed.set(entry.song_id, entry.played_at);
    }
  }

  // Find the oldest last_played_at among candidates
  let oldestDate: Date | null = null;
  const withHistory: CandidateSong[] = [];
  const withoutHistory: CandidateSong[] = [];

  for (const song of candidates) {
    const lp = lastPlayed.get(song.id);
    if (lp === undefined) {
      withoutHistory.push(song);
    } else {
      if (oldestDate === null || lp < oldestDate) {
        oldestDate = lp;
      }
      withHistory.push(song);
    }
  }

  // Songs never played take priority (randomly among them)
  if (withoutHistory.length > 0) {
    return randomFrom(withoutHistory);
  }

  // Among played songs, pick the one(s) with the oldest play time
  const tied = withHistory.filter((s) => {
    const lp = lastPlayed.get(s.id);
    return lp !== undefined && lp.getTime() === (oldestDate as Date).getTime();
  });

  return randomFrom(tied.length > 0 ? tied : withHistory);
}

/**
 * Filter candidates by rotation rules.
 * relaxGap: skip min_gap_hours check
 * relaxDayLimit: skip max_plays_per_day check
 */
export function filterCandidates(
  candidates: CandidateSong[],
  rules: RotationRules,
  recentHistory: PlayHistoryEntry[],
  dayPlayCounts: Map<string, number>,
  placedEntries: PlacedEntry[],
  currentHour: number,
  currentPosition: number,
  relaxGap: boolean,
  relaxDayLimit: boolean,
): CandidateSong[] {
  const now = Date.now();
  const minGapMs = rules.min_gap_hours * 60 * 60 * 1000;

  return candidates.filter((song) => {
    // Check max_plays_per_day
    if (!relaxDayLimit) {
      const plays = dayPlayCounts.get(song.id) ?? 0;
      if (plays >= rules.max_plays_per_day) return false;
    }

    // Check min_gap_hours from play_history
    if (!relaxGap) {
      const lastPlay = recentHistory
        .filter((h) => h.song_id === song.id)
        .sort((a, b) => b.played_at.getTime() - a.played_at.getTime())[0];
      if (lastPlay) {
        const elapsed = now - lastPlay.played_at.getTime();
        if (elapsed < minGapMs) return false;
      }
    }

    // Check artist_separation_slots: look back N positions in playlist (across all hours)
    const allPlaced = placedEntries.slice(); // already in order
    const currentAbsolutePosition =
      allPlaced.length; // index of the entry we are about to place
    const separationStart = Math.max(0, currentAbsolutePosition - rules.artist_separation_slots);
    const nearbyEntries = allPlaced.slice(separationStart);
    if (nearbyEntries.some((e) => e.artist.toLowerCase() === song.artist.toLowerCase())) {
      return false;
    }

    // Check max_same_artist_per_hour
    const sameArtistThisHour = placedEntries.filter(
      (e) =>
        e.hour === currentHour &&
        e.artist.toLowerCase() === song.artist.toLowerCase(),
    ).length;
    if (sameArtistThisHour >= rules.max_same_artist_per_hour) return false;

    return true;
  });
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generatePlaylist(
  params: GeneratePlaylistParams,
): Promise<GeneratePlaylistResult> {
  const { stationId, date, templateId, triggeredBy, userId } = params;
  const pool = getPool();

  // ── Step 1: Find or create playlist row ────────────────────────────────────
  let playlistId: string;

  const existingRes = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM playlists WHERE station_id = $1 AND date = $2`,
    [stationId, date],
  );

  if (existingRes.rows.length > 0) {
    const existing = existingRes.rows[0];
    if (existing.status === 'approved') {
      throw new Error('Playlist already approved');
    }
    if (existing.status === 'generating') {
      throw new Error('Already generating');
    }
    playlistId = existing.id;
    await pool.query(
      `UPDATE playlists SET status = 'generating' WHERE id = $1`,
      [playlistId],
    );
  } else {
    const insertRes = await pool.query<{ id: string }>(
      `INSERT INTO playlists (station_id, date, status, generated_by)
       VALUES ($1, $2, 'generating', $3)
       RETURNING id`,
      [stationId, date, userId ?? null],
    );
    playlistId = insertRes.rows[0].id;
  }

  // ── Step 2: Create generation_job row ──────────────────────────────────────
  const jobRes = await pool.query<{ id: string }>(
    `INSERT INTO generation_jobs (station_id, playlist_id, status, triggered_by)
     VALUES ($1, $2, 'queued', $3)
     RETURNING id`,
    [stationId, playlistId, triggeredBy],
  );
  const jobId = jobRes.rows[0].id;

  // ── Step 3: Mark job started ────────────────────────────────────────────────
  await pool.query(
    `UPDATE generation_jobs SET status = 'processing', started_at = NOW() WHERE id = $1`,
    [jobId],
  );

  try {
    // ── Step 4: Load template ─────────────────────────────────────────────────
    let resolvedTemplateId: string;

    if (templateId) {
      const tplRes = await pool.query<{ id: string }>(
        `SELECT id FROM templates WHERE id = $1 AND station_id = $2`,
        [templateId, stationId],
      );
      if (tplRes.rows.length === 0) {
        throw new Error(`Template ${templateId} not found for station ${stationId}`);
      }
      resolvedTemplateId = tplRes.rows[0].id;
    } else {
      const tplRes = await pool.query<{ id: string }>(
        `SELECT id FROM templates WHERE station_id = $1 AND is_default = true AND is_active = true LIMIT 1`,
        [stationId],
      );
      if (tplRes.rows.length === 0) {
        throw new Error(`No default active template found for station ${stationId}`);
      }
      resolvedTemplateId = tplRes.rows[0].id;
    }

    // ── Step 5: Load template slots ───────────────────────────────────────────
    const slotsRes = await pool.query<TemplateSlot>(
      `SELECT ts.id, ts.template_id, ts.hour, ts.position, ts.required_category_id,
              c.code as category_code
       FROM template_slots ts
       JOIN categories c ON c.id = ts.required_category_id
       WHERE ts.template_id = $1
       ORDER BY ts.hour, ts.position`,
      [resolvedTemplateId],
    );
    const slots = slotsRes.rows;

    // ── Step 6: Load rotation rules ───────────────────────────────────────────
    const rulesRes = await pool.query<{ rules: RotationRules }>(
      `SELECT rules FROM rotation_rules WHERE station_id = $1`,
      [stationId],
    );
    const rules: RotationRules =
      rulesRes.rows.length > 0
        ? { ...DEFAULT_ROTATION_RULES, ...rulesRes.rows[0].rules }
        : { ...DEFAULT_ROTATION_RULES };

    const minGapHours = rules.min_gap_hours;

    // ── Step 7: Load recent play_history for gap checking ─────────────────────
    const recentHistoryRes = await pool.query<{ song_id: string; played_at: Date }>(
      `SELECT song_id, played_at
       FROM play_history
       WHERE station_id = $1
         AND played_at >= NOW() - ($2 || ' hours')::interval`,
      [stationId, String(minGapHours * 2)],
    );
    const recentHistory: PlayHistoryEntry[] = recentHistoryRes.rows;

    // ── Step 8: Load today's play counts ──────────────────────────────────────
    const dayCountsRes = await pool.query<{ song_id: string; plays: string }>(
      `SELECT song_id, COUNT(*) as plays
       FROM play_history
       WHERE station_id = $1 AND played_at::date = $2
       GROUP BY song_id`,
      [stationId, date],
    );
    const dayPlayCounts = new Map<string, number>(
      dayCountsRes.rows.map((r) => [r.song_id, Number(r.plays)]),
    );

    // ── Step 9 prep: Load existing manual overrides ───────────────────────────
    const overridesRes = await pool.query<ManualOverride>(
      `SELECT hour, position, song_id
       FROM playlist_entries
       WHERE playlist_id = $1 AND is_manual_override = true`,
      [playlistId],
    );
    const overrideSet = new Set<string>(
      overridesRes.rows.map((o) => `${o.hour}:${o.position}`),
    );
    const overrideMap = new Map<string, string>(
      overridesRes.rows.map((o) => [`${o.hour}:${o.position}`, o.song_id]),
    );

    // ── Step 9: Generate entries for each slot ────────────────────────────────
    const placedEntries: PlacedEntry[] = [];
    // Seed with manual overrides so artist separation logic sees them
    for (const override of overridesRes.rows) {
      // We need the artist for the overridden song to enforce separation
      const artistRes = await pool.query<{ artist: string }>(
        `SELECT artist FROM songs WHERE id = $1`,
        [override.song_id],
      );
      if (artistRes.rows.length > 0) {
        placedEntries.push({
          hour: override.hour,
          position: override.position,
          song_id: override.song_id,
          artist: artistRes.rows[0].artist,
        });
      }
    }
    // Sort placedEntries to maintain hour/position order
    placedEntries.sort((a, b) => a.hour - b.hour || a.position - b.position);

    const newEntries: Array<{ hour: number; position: number; song_id: string }> = [];

    for (const slot of slots) {
      const slotKey = `${slot.hour}:${slot.position}`;

      // Skip slots that already have a manual override
      if (overrideSet.has(slotKey)) {
        continue;
      }

      // Find candidate songs eligible for this hour and category
      // If no song_slots rows exist for a song, treat as eligible for all hours
      const candidatesRes = await pool.query<CandidateSong>(
        `SELECT s.id, s.artist
         FROM songs s
         WHERE s.station_id = $1
           AND s.category_id = $2
           AND s.is_active = true
           AND (
             EXISTS (SELECT 1 FROM song_slots ss WHERE ss.song_id = s.id AND ss.eligible_hour = $3)
             OR NOT EXISTS (SELECT 1 FROM song_slots ss2 WHERE ss2.song_id = s.id)
           )`,
        [stationId, slot.required_category_id, slot.hour],
      );
      const allCandidates = candidatesRes.rows;

      // Try with full rules
      let filtered = filterCandidates(
        allCandidates,
        rules,
        recentHistory,
        dayPlayCounts,
        placedEntries,
        slot.hour,
        slot.position,
        false,
        false,
      );

      let picked = pickBestCandidate(filtered, recentHistory);

      // Relaxation tier 1: no gap constraint
      if (!picked) {
        console.warn(
          `[generationEngine] Relaxing gap constraint for slot ${slot.hour}:${slot.position} station=${stationId}`,
        );
        filtered = filterCandidates(
          allCandidates,
          rules,
          recentHistory,
          dayPlayCounts,
          placedEntries,
          slot.hour,
          slot.position,
          true,
          false,
        );
        picked = pickBestCandidate(filtered, recentHistory);
      }

      // Relaxation tier 2: no gap constraint and no day limit
      if (!picked) {
        console.warn(
          `[generationEngine] Relaxing day-limit constraint for slot ${slot.hour}:${slot.position} station=${stationId}`,
        );
        filtered = filterCandidates(
          allCandidates,
          rules,
          recentHistory,
          dayPlayCounts,
          placedEntries,
          slot.hour,
          slot.position,
          true,
          true,
        );
        picked = pickBestCandidate(filtered, recentHistory);
      }

      // Relaxation tier 3: any active song in category (ignore all constraints)
      if (!picked) {
        console.warn(
          `[generationEngine] Picking any song in category for slot ${slot.hour}:${slot.position} station=${stationId}`,
        );
        picked = pickBestCandidate(allCandidates, recentHistory);
      }

      if (!picked) {
        console.warn(
          `[generationEngine] No songs available for slot ${slot.hour}:${slot.position} category=${slot.required_category_id} station=${stationId} — skipping`,
        );
        continue;
      }

      newEntries.push({ hour: slot.hour, position: slot.position, song_id: picked.id });

      // Track this placement for subsequent slot filtering
      placedEntries.push({
        hour: slot.hour,
        position: slot.position,
        song_id: picked.id,
        artist: picked.artist,
      });

      // Update day play counts in-memory
      dayPlayCounts.set(picked.id, (dayPlayCounts.get(picked.id) ?? 0) + 1);
    }

    // ── Steps 10–13: Transaction for upsert + play_history ───────────────────
    const client: PoolClient = await pool.connect();
    let entriesCount = 0;

    try {
      await client.query('BEGIN');

      // Upsert new entries (skip manual overrides via ON CONFLICT condition)
      for (const entry of newEntries) {
        await client.query(
          `INSERT INTO playlist_entries (playlist_id, hour, position, song_id, is_manual_override)
           VALUES ($1, $2, $3, $4, false)
           ON CONFLICT (playlist_id, hour, position)
           DO UPDATE SET song_id = EXCLUDED.song_id
           WHERE playlist_entries.is_manual_override = false`,
          [playlistId, entry.hour, entry.position, entry.song_id],
        );
        entriesCount++;
      }

      // Also count manual override entries in total
      entriesCount += overridesRes.rows.length;

      // Insert play_history for all newly placed songs
      const now = new Date();
      for (const entry of newEntries) {
        await client.query(
          `INSERT INTO play_history (station_id, song_id, played_at)
           VALUES ($1, $2, $3)`,
          [stationId, entry.song_id, now],
        );
      }

      // Update playlist status to ready
      await client.query(
        `UPDATE playlists
         SET status = 'ready', generated_at = NOW(), generated_by = $2
         WHERE id = $1`,
        [playlistId, userId ?? null],
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // ── Step 14: Mark job completed ───────────────────────────────────────────
    await pool.query(
      `UPDATE generation_jobs SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [jobId],
    );

    return { playlistId, entriesCount };
  } catch (err) {
    // ── Step 15: Handle errors ────────────────────────────────────────────────
    const message = err instanceof Error ? err.message : String(err);

    await pool.query(
      `UPDATE playlists SET status = 'failed' WHERE id = $1`,
      [playlistId],
    ).catch((e) => console.error('Failed to update playlist status to failed', e));

    await pool.query(
      `UPDATE generation_jobs SET status = 'failed', error_message = $2 WHERE id = $1`,
      [jobId, message],
    ).catch((e) => console.error('Failed to update job status to failed', e));

    throw err;
  }
}
