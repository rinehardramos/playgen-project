import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config.js';
import { getStorageAdapter } from '../lib/storage/index.js';
import { getPool } from '../db.js';

export interface AudioCleanupJobData {
  retentionDays: number;
}

const QUEUE_NAME = 'audio-cleanup' as const;

const redisConnection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
      host: config.redis.host,
      port: config.redis.port,
      ...(config.redis.password ? { password: config.redis.password } : {}),
    };

const cleanupQueue = new Queue<AudioCleanupJobData>(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
  },
});

/**
 * Core cleanup logic — exported so it can be unit-tested independently of
 * the BullMQ worker.
 */
export async function runAudioCleanup(retentionDays: number): Promise<void> {
  const storage = getStorageAdapter();
  const pool = getPool();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  console.info(
    `[audioCleanup] Starting audio cleanup — retentionDays=${retentionDays}, cutoff=${cutoff.toISOString()}`,
  );

  // Fetch segments that have audio and were generated before the cutoff date.
  const { rows } = await pool.query<{ id: string; audio_url: string }>(
    `SELECT id, audio_url
     FROM dj_segments
     WHERE audio_url IS NOT NULL
       AND tts_generated_at < $1`,
    [cutoff.toISOString()],
  );

  console.info(`[audioCleanup] Found ${rows.length} segment(s) eligible for deletion`);

  let deleted = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      // audio_url format: /dj/audio/<script_id>/<position>.mp3
      // Strip the leading slash and the fixed /dj/audio/ prefix to get the
      // relative storage path (matches how ttsService writes files).
      const relativePath = row.audio_url.replace(/^\/dj\/audio\//, '');

      const fileExists = await storage.exists(relativePath);
      if (fileExists) {
        await storage.delete(relativePath);
        console.info(`[audioCleanup] Deleted audio file: ${relativePath} (segment=${row.id})`);
      } else {
        console.warn(
          `[audioCleanup] Audio file not found in storage, clearing DB ref only: ${relativePath} (segment=${row.id})`,
        );
      }

      // Clear the audio_url reference in the DB regardless of whether the
      // file existed — the retention window has passed.
      await pool.query(
        `UPDATE dj_segments
         SET audio_url = NULL, audio_duration_sec = NULL, updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );

      deleted++;
    } catch (err) {
      errors++;
      console.error(
        `[audioCleanup] Failed to clean up segment ${row.id} (audio_url=${row.audio_url}):`,
        err,
      );
    }
  }

  console.info(
    `[audioCleanup] Cleanup complete — deleted=${deleted}, errors=${errors}, total=${rows.length}`,
  );
}

const cleanupWorker = new Worker<AudioCleanupJobData>(
  QUEUE_NAME,
  async (job: Job<AudioCleanupJobData>) => {
    await runAudioCleanup(job.data.retentionDays);
  },
  { connection: redisConnection, concurrency: 1 },
);

cleanupWorker.on('completed', (job) => {
  console.info(
    `[audioCleanupQueue] Job ${job.id} completed — retentionDays=${job.data.retentionDays}`,
  );
});

cleanupWorker.on('failed', (job, err) => {
  console.error(
    `[audioCleanupQueue] Job ${job?.id} failed — retentionDays=${job?.data.retentionDays}`,
    err,
  );
});

/**
 * Schedule a daily audio cleanup job at midnight UTC using BullMQ's
 * built-in repeat/cron support.
 */
export async function scheduleAudioCleanup(): Promise<void> {
  const retentionDays = config.audioRetentionDays;

  // Remove any previously scheduled repeatable jobs before re-registering to
  // avoid duplicates across restarts.
  const repeatableJobs = await cleanupQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === 'audio-cleanup-daily') {
      await cleanupQueue.removeRepeatableByKey(job.key);
    }
  }

  await cleanupQueue.add(
    'audio-cleanup-daily',
    { retentionDays },
    {
      repeat: { pattern: '0 0 * * *' }, // every day at midnight UTC
      jobId: 'audio-cleanup-daily',
    },
  );

  console.info(
    `[audioCleanupQueue] Daily audio cleanup scheduled — retentionDays=${retentionDays}`,
  );
}

export async function closeCleanupQueue(): Promise<void> {
  await cleanupWorker.close();
  await cleanupQueue.close();
}
