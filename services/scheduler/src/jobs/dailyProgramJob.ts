import cron, { ScheduledTask } from 'node-cron';
import { getPool } from '../db';
import { enqueueGeneration } from '../services/queueService';
import { getDayOfWeek } from '../services/generationEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveProgram {
  id: string;
  station_id: string;
  template_id: string | null;
}

// ─── Cron state ───────────────────────────────────────────────────────────────

let _scheduledTask: ScheduledTask | null = null;

// ─── Core tick handler ────────────────────────────────────────────────────────

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

// ─── Schedule registration ────────────────────────────────────────────────────

/**
 * Register the daily program generation cron job using BullMQ's node-cron
 * compatible expression.
 *
 * Hour is configurable via DAILY_GENERATION_HOUR (0–23, default 2).
 * Full expression can be overridden with DAILY_PROGRAM_CRON.
 */
export function scheduleDailyGeneration(): void {
  if (_scheduledTask) {
    console.warn('[dailyProgramJob] Already scheduled — ignoring duplicate call');
    return;
  }

  const hour = Number(process.env.DAILY_GENERATION_HOUR ?? 2);
  const expression = process.env.DAILY_PROGRAM_CRON ?? `0 ${hour} * * *`;

  if (!cron.validate(expression)) {
    throw new Error(`[dailyProgramJob] Invalid cron expression: "${expression}"`);
  }

  _scheduledTask = cron.schedule(expression, () => {
    runDailyProgramGeneration().catch((err) => {
      console.error('[dailyProgramJob] Unhandled error in runDailyProgramGeneration', err);
    });
  });

  console.info(`[dailyProgramJob] Scheduled with expression="${expression}"`);
}

/**
 * Stop the daily program generation cron job. Called on graceful shutdown.
 */
export function stopDailyGeneration(): void {
  if (_scheduledTask) {
    _scheduledTask.stop();
    _scheduledTask = null;
    console.info('[dailyProgramJob] Stopped');
  }
}
