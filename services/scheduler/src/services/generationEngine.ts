import { PoolClient } from 'pg';
import { DEFAULT_ROTATION_RULES } from '@playgen/types';
import { getPool } from '../db';

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


interface ProgramClock {
  program_id: string;
  start_hour: number;
  end_hour: number;
  clock_id: string;
}

interface ClockSongSlot {
  clock_id: string;
  position: number;
  category_id: string;
}

interface CandidateSong {
  id: string;
  artist: string;
}

interface SongWithEligibility {
  id: string;
  artist: string;
  station_id: string;
  category_id: string;
  eligible_hours: number[];
}

interface PlayHistoryEntry {
  song_id: string;
  played_at: Date;
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
  pipelineRunId?: string;
}

export interface GeneratePlaylistResult {
  playlistId: string;
  entriesCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Day-of-week string (e.g. 'monday') for a 'YYYY-MM-DD' date string. */
export function getDayOfWeek(date: string): string {
  const DOW_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return DOW_NAMES[new Date(date + 'T12:00:00Z').getUTCDay()];
}

/**
 * Build the ordered slot list for a generation run.
 * Clock slots override template slots per hour. Exported for unit testing.
 */
export function buildSlotList(
  templateSlots: TemplateSlot[],
  hourClockMap: Map<number, string>,
  clockSongSlotsMap: Map<string, ClockSongSlot[]>,
  resolvedTemplateId: string,
): TemplateSlot[] {
  const hoursInTemplate = new Set(templateSlots.map((s) => s.hour));
  const allHours = new Set([...hoursInTemplate, ...hourClockMap.keys()]);
  const slots: TemplateSlot[] = [];

  for (const hour of [...allHours].sort((a, b) => a - b)) {
    const clockId = hourClockMap.get(hour);
    if (clockId) {
      const clockSlots = clockSongSlotsMap.get(clockId) ?? [];
      for (const cs of clockSlots) {
        slots.push({
          id: `clock:${clockId}:${hour}:${cs.position}`,
          template_id: resolvedTemplateId,
          hour,
          position: cs.position,
          required_category_id: cs.category_id,
          category_code: '',
        });
      }
    } else {
      for (const ts of templateSlots.filter((s) => s.hour === hour)) {
        slots.push(ts);
      }
    }
  }

  return slots;
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
    // ── Step 3b: Resolve parent station (for template + library inheritance) ──
    const stationMetaRes = await pool.query<{
      parent_station_id: string | null;
      inherit_library: boolean;
    }>(
      `SELECT parent_station_id, inherit_library FROM stations WHERE id = $1`,
      [stationId],
    );
    const parentStationId = stationMetaRes.rows[0]?.parent_station_id ?? null;
    const inheritLibrary = stationMetaRes.rows[0]?.inherit_library ?? false;

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
        // Fallback: try parent station's default template
        if (parentStationId) {
          const parentTplRes = await pool.query<{ id: string }>(
            `SELECT id FROM templates WHERE station_id = $1 AND is_default = true AND is_active = true LIMIT 1`,
            [parentStationId],
          );
          if (parentTplRes.rows.length === 0) {
            throw new Error(`No default active template found for station ${stationId} or its parent ${parentStationId}`);
          }
          resolvedTemplateId = parentTplRes.rows[0].id;
        } else {
          throw new Error(`No default active template found for station ${stationId}`);
        }
      } else {
        resolvedTemplateId = tplRes.rows[0].id;
      }
    }

    // ── Step 5: Load template slots (fallback source) ────────────────────────
    const slotsRes = await pool.query<TemplateSlot>(
      `SELECT ts.id, ts.template_id, ts.hour, ts.position, ts.required_category_id,
              c.code as category_code
       FROM template_slots ts
       JOIN categories c ON c.id = ts.required_category_id
       WHERE ts.template_id = $1
       ORDER BY ts.hour, ts.position`,
      [resolvedTemplateId],
    );
    const templateSlots = slotsRes.rows;

    // ── Step 5a: Find programs with clocks covering each hour of this date ───
    const programClocksRes = await pool.query<ProgramClock>(
      `SELECT p.id AS program_id, p.start_hour, p.end_hour, p.default_clock_id AS clock_id
       FROM programs p
       WHERE p.station_id = $1
         AND p.is_active = TRUE
         AND p.default_clock_id IS NOT NULL
         AND $2 = ANY(p.active_days)
       ORDER BY p.is_default ASC, p.start_hour ASC`,
      [stationId, getDayOfWeek(date)],
    );

    const hourClockMap = new Map<number, string>();
    for (const pc of programClocksRes.rows) {
      for (let h = pc.start_hour; h < pc.end_hour; h++) {
        if (!hourClockMap.has(h)) hourClockMap.set(h, pc.clock_id);
      }
    }

    const neededClockIds = [...new Set(hourClockMap.values())];
    const clockSongSlotsMap = new Map<string, ClockSongSlot[]>();
    if (neededClockIds.length > 0) {
      const clockSlotsRes = await pool.query<ClockSongSlot>(
        `SELECT clock_id, position, category_id
         FROM show_clock_slots
         WHERE clock_id = ANY($1) AND content_type = 'song' AND category_id IS NOT NULL
         ORDER BY clock_id, position`,
        [neededClockIds],
      );
      for (const row of clockSlotsRes.rows) {
        const arr = clockSongSlotsMap.get(row.clock_id) ?? [];
        arr.push(row);
        clockSongSlotsMap.set(row.clock_id, arr);
      }
    }

    for (const [hour, clockId] of hourClockMap) {
      console.info(
        `[generationEngine] Hour ${hour}: clock ${clockId} (${clockSongSlotsMap.get(clockId)?.length ?? 0} song slots), station=${stationId}`,
      );
    }

    const slots = buildSlotList(templateSlots, hourClockMap, clockSongSlotsMap, resolvedTemplateId);

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

    // ── Step 9a: Batch-load ALL active songs with eligibility (single query) ─
    // When inherit_library=true, include songs from all stations in the same company.
    const stationIds = [stationId];
    if (inheritLibrary) {
      if (parentStationId) stationIds.push(parentStationId);
      const { rows: siblings } = await pool.query<{ id: string }>(
        `SELECT id FROM stations
         WHERE company_id = (SELECT company_id FROM stations WHERE id = $1)
           AND id != $1 AND is_active = true`,
        [stationId],
      );
      for (const s of siblings) {
        if (!stationIds.includes(s.id)) stationIds.push(s.id);
      }
    }

    const songQuery = `SELECT s.id, s.artist, s.station_id, s.category_id,
              COALESCE(
                array_agg(DISTINCT ss.eligible_hour) FILTER (WHERE ss.eligible_hour IS NOT NULL),
                '{}'
              ) AS eligible_hours
       FROM songs s
       LEFT JOIN song_slots ss ON ss.song_id = s.id
       WHERE s.station_id = ANY($1) AND s.is_active = true
       GROUP BY s.id, s.station_id`;

    const allSongsRes = await pool.query<SongWithEligibility>(songQuery, [stationIds]);
    let allSongs = allSongsRes.rows;

    // ── Step 9a fallback: use master library stations when this station has no songs ─
    // This covers stations created via the OwnRadio wizard with no music library assigned.
    if (allSongs.length === 0) {
      const { rows: masterStations } = await pool.query<{ id: string }>(
        `SELECT id FROM stations WHERE is_master_library = TRUE AND is_active = TRUE AND id != $1`,
        [stationId],
      );
      if (masterStations.length > 0) {
        const masterIds = masterStations.map((s) => s.id);
        console.warn(
          `[generationEngine] Station ${stationId} has no songs — falling back to master library stations: ${masterIds.join(', ')}`,
        );
        const fallbackRes = await pool.query<SongWithEligibility>(songQuery, [masterIds]);
        allSongs = fallbackRes.rows;
      }
    }

    // Build in-memory index: categoryId -> songs[]
    // When inherit_library=true, remap sibling songs' category_ids to the matching
    // category in the current station (matched by category code). This makes inherited
    // songs visible under the current station's template slot categories.
    const songsByCategory = new Map<string, SongWithEligibility[]>();

    if (inheritLibrary && stationIds.length > 1) {
      // Load categories for all involved stations to build a code-based remap
      const { rows: allCats } = await pool.query<{ station_id: string; id: string; code: string }>(
        `SELECT station_id, id, code FROM categories WHERE station_id = ANY($1)`,
        [stationIds],
      );
      // Map: own station category code → category_id
      const ownCatByCode = new Map<string, string>();
      for (const cat of allCats) {
        if (cat.station_id === stationId) ownCatByCode.set(cat.code, cat.id);
      }
      // Map: sibling category_id → category code
      const catCodeById = new Map<string, string>(allCats.map((c) => [c.id, c.code]));

      for (const song of allSongs) {
        // Own station songs: index by their actual category_id (no remap)
        let effectiveCategoryId = song.category_id;
        if (song.station_id !== stationId) {
          // Remap sibling song to current station's matching category by code
          const code = catCodeById.get(song.category_id);
          const ownCatId = code ? ownCatByCode.get(code) : undefined;
          if (ownCatId) effectiveCategoryId = ownCatId;
        }
        const arr = songsByCategory.get(effectiveCategoryId) ?? [];
        arr.push(song);
        songsByCategory.set(effectiveCategoryId, arr);
      }
    } else {
      for (const song of allSongs) {
        const arr = songsByCategory.get(song.category_id) ?? [];
        arr.push(song);
        songsByCategory.set(song.category_id, arr);
      }
    }

    // Build artist lookup for overrides (single query instead of N)
    const placedEntries: PlacedEntry[] = [];
    if (overridesRes.rows.length > 0) {
      const overrideSongIds = overridesRes.rows.map((o) => o.song_id);
      const artistRes = await pool.query<{ id: string; artist: string }>(
        `SELECT id, artist FROM songs WHERE id = ANY($1)`,
        [overrideSongIds],
      );
      const artistMap = new Map(artistRes.rows.map((r) => [r.id, r.artist]));
      for (const override of overridesRes.rows) {
        const artist = artistMap.get(override.song_id);
        if (artist) {
          placedEntries.push({
            hour: override.hour,
            position: override.position,
            song_id: override.song_id,
            artist,
          });
        }
      }
    }
    // Sort placedEntries to maintain hour/position order
    placedEntries.sort((a, b) => a.hour - b.hour || a.position - b.position);

    // ── Step 9b: Generate entries for each slot (in-memory filtering) ─────────
    const newEntries: Array<{ hour: number; position: number; song_id: string }> = [];

    for (const slot of slots) {
      const slotKey = `${slot.hour}:${slot.position}`;

      // Skip slots that already have a manual override
      if (overrideSet.has(slotKey)) {
        continue;
      }

      // Filter candidates from in-memory index by category and hour eligibility
      const categorySongs = songsByCategory.get(slot.required_category_id) ?? [];
      const allCandidates: CandidateSong[] = categorySongs
        .filter((s) => s.eligible_hours.length === 0 || s.eligible_hours.includes(slot.hour))
        .map((s) => ({ id: s.id, artist: s.artist }));

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

    // ── Steps 10–13: Transaction for batch upsert + play_history ──────────────
    const client: PoolClient = await pool.connect();
    const entriesCount = newEntries.length + overridesRes.rows.length;

    try {
      await client.query('BEGIN');

      // Batch upsert new entries (single query instead of N individual inserts)
      if (newEntries.length > 0) {
        const hours = newEntries.map((e) => e.hour);
        const positions = newEntries.map((e) => e.position);
        const songIds = newEntries.map((e) => e.song_id);

        await client.query(
          `INSERT INTO playlist_entries (playlist_id, hour, position, song_id, is_manual_override)
           SELECT $1, h, p, s, false
           FROM unnest($2::int[], $3::int[], $4::uuid[]) AS t(h, p, s)
           ON CONFLICT (playlist_id, hour, position)
           DO UPDATE SET song_id = EXCLUDED.song_id
           WHERE playlist_entries.is_manual_override = false`,
          [playlistId, hours, positions, songIds],
        );

        // Batch play_history (single query instead of N individual inserts)
        const now = new Date();
        await client.query(
          `INSERT INTO play_history (station_id, song_id, played_at)
           SELECT $1, s, $3 FROM unnest($2::uuid[]) AS t(s)`,
          [stationId, songIds, now],
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
