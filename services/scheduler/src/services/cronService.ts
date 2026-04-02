import cron, { ScheduledTask } from 'node-cron';
import { Pool } from 'pg';
import { enqueueGeneration } from './queueService';

// ─── Pool singleton for cron queries ─────────────────────────────────────────

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'playgen',
      user: process.env.POSTGRES_USER ?? 'playgen',
      password: process.env.POSTGRES_PASSWORD ?? 'changeme',
      max: 5,
    });
    _pool.on('error', (err) => console.error('pg pool error (cronService)', err));
  }
  return _pool;
}

// ─── Cron state ───────────────────────────────────────────────────────────────

let scheduledTask: ScheduledTask | null = null;

// ─── Core tick handler ────────────────────────────────────────────────────────

async function runDailyGeneration(): Promise<void> {
  const pool = getPool();

  // Calculate tomorrow's date in YYYY-MM-DD format
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = tomorrow.toISOString().slice(0, 10);

  console.info(`[cronService] Daily generation tick — targeting date=${targetDate}`);

  let activeStations: Array<{ id: string }>;

  try {
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM stations WHERE is_active = true`,
    );
    activeStations = res.rows;
  } catch (err) {
    console.error('[cronService] Failed to query active stations', err);
    return;
  }

  console.info(`[cronService] Enqueueing generation for ${activeStations.length} station(s)`);

  for (const station of activeStations) {
    try {
      const jobId = await enqueueGeneration({
        stationId: station.id,
        date: targetDate,
        triggeredBy: 'cron',
      });
      console.info(
        `[cronService] Enqueued job=${jobId} station=${station.id} date=${targetDate}`,
      );
    } catch (err) {
      console.error(
        `[cronService] Failed to enqueue generation for station=${station.id}`,
        err,
      );
    }
  }
}

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Start the daily generation cron job.
 * Cron expression is read from GENERATION_CRON env var (default: '0 23 * * *' — 11 PM daily).
 */
export function startCron(): void {
  if (scheduledTask) {
    console.warn('[cronService] Cron already running — ignoring startCron call');
    return;
  }

  const expression = process.env.GENERATION_CRON ?? '0 23 * * *';

  if (!cron.validate(expression)) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }

  scheduledTask = cron.schedule(expression, () => {
    runDailyGeneration().catch((err) => {
      console.error('[cronService] Unhandled error in runDailyGeneration', err);
    });
  });

  console.info(`[cronService] Cron started with expression="${expression}"`);
}

/**
 * Stop the cron job.
 */
export function stopCron(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.info('[cronService] Cron stopped');
  }
}
