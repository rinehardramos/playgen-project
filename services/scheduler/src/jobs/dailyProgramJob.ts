import { getPool } from '../db';
import { enqueueGeneration } from '../services/queueService';
import { getDayOfWeek } from '../services/generationEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveProgram {
  id: string;
  station_id: string;
  template_id: string | null;
}

// ─── Core generation handler ─────────────────────────────────────────────────

/**
 * Query active programs for tomorrow's day-of-week and enqueue playlist
 * generation for each one that does not yet have a playlist in a terminal
 * or in-progress state.
 */
export async function runDailyProgramGeneration(): Promise<void> {
  const pool = getPool();

  // ── Calculate tomorrow ────────────────────────────────────────────────────
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = tomorrow.toISOString().slice(0, 10);
  const dayOfWeek = getDayOfWeek(targetDate);

  console.info(
    `[dailyProgramJob] Daily generation tick — targetDate=${targetDate} dayOfWeek=${dayOfWeek}`,
  );

  // ── Load active programs for tomorrow's day-of-week ───────────────────────
  let programs: ActiveProgram[];
  try {
    const res = await pool.query<ActiveProgram>(
      `SELECT p.id, p.station_id, p.template_id
       FROM programs p
       WHERE p.is_active = TRUE
         AND $1 = ANY(p.active_days)`,
      [dayOfWeek],
    );
    programs = res.rows;
  } catch (err) {
    console.error('[dailyProgramJob] Failed to query active programs', err);
    return;
  }

  if (programs.length === 0) {
    console.info(`[dailyProgramJob] No active programs for ${dayOfWeek} — nothing to enqueue`);
    return;
  }

  // ── Load existing playlists for targetDate to implement idempotency ───────
  // A playlist in 'approved', 'ready', or 'generating' state is considered
  // already handled; only skip those. A 'failed' playlist is re-queued so it
  // gets another attempt.
  const stationIds = [...new Set(programs.map((p) => p.station_id))];
  let skipSet: Set<string>;
  try {
    const existingRes = await pool.query<{ station_id: string; status: string }>(
      `SELECT station_id, status
       FROM playlists
       WHERE date = $1
         AND station_id = ANY($2)
         AND status IN ('approved', 'ready', 'generating')`,
      [targetDate, stationIds],
    );
    skipSet = new Set(existingRes.rows.map((r) => r.station_id));
  } catch (err) {
    console.error('[dailyProgramJob] Failed to query existing playlists', err);
    return;
  }

  // ── Enqueue generation for each eligible program ──────────────────────────
  let queued = 0;
  let skipped = 0;

  for (const program of programs) {
    if (skipSet.has(program.station_id)) {
      console.info(
        `[dailyProgramJob] Skipping program=${program.id} station=${program.station_id} — playlist already exists for ${targetDate}`,
      );
      skipped++;
      continue;
    }

    try {
      const jobId = await enqueueGeneration({
        stationId: program.station_id,
        date: targetDate,
        templateId: program.template_id ?? undefined,
        triggeredBy: 'cron',
      });
      console.info(
        `[dailyProgramJob] Enqueued job=${jobId} program=${program.id} station=${program.station_id} date=${targetDate}`,
      );
      queued++;
      // Mark station as handled for subsequent programs on the same station
      skipSet.add(program.station_id);
    } catch (err) {
      console.error(
        `[dailyProgramJob] Failed to enqueue program=${program.id} station=${program.station_id}`,
        err,
      );
    }
  }

  console.info(
    `[dailyProgramJob] Daily generation: queued ${queued} playlists for ${targetDate} (${skipped} skipped)`,
  );
}

/**
 * Run daily generation for a specific date (defaults to tomorrow).
 * Returns summary of what was queued.
 */
export async function runDailyProgramGenerationForDate(
  targetDate?: string,
): Promise<{ date: string; queued: number; skipped: number }> {
  const date = targetDate ?? getDefaultTargetDate();
  const dayOfWeek = getDayOfWeek(date);

  console.info(`[dailyProgramJob] Triggered for date=${date} dayOfWeek=${dayOfWeek}`);

  const pool = getPool();

  const { rows: programs } = await pool.query<ActiveProgram>(
    `SELECT p.id, p.station_id, p.template_id
     FROM programs p
     WHERE p.is_active = TRUE AND $1 = ANY(p.active_days)`,
    [dayOfWeek],
  );

  if (programs.length === 0) {
    return { date, queued: 0, skipped: 0 };
  }

  const stationIds = [...new Set(programs.map(p => p.station_id))];
  const { rows: existing } = await pool.query<{ station_id: string }>(
    `SELECT station_id FROM playlists
     WHERE date = $1 AND station_id = ANY($2)
       AND status IN ('approved', 'ready', 'generating')`,
    [date, stationIds],
  );
  const skipSet = new Set(existing.map(r => r.station_id));

  let queued = 0;
  let skipped = 0;

  for (const program of programs) {
    if (skipSet.has(program.station_id)) { skipped++; continue; }
    await enqueueGeneration({
      stationId: program.station_id,
      date,
      templateId: program.template_id ?? undefined,
      triggeredBy: 'cron',
    });
    queued++;
    skipSet.add(program.station_id);
  }

  return { date, queued, skipped };
}

function getDefaultTargetDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}
