import { Queue, Worker, Job } from 'bullmq';
import { generatePlaylist, GeneratePlaylistParams } from './generationEngine';

// ─── Redis connection config ──────────────────────────────────────────────────
// REDIS_URL takes precedence (Railway Redis, Upstash, etc.)
// Falls back to individual REDIS_HOST / REDIS_PORT for local Docker Compose.

const redisConnection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
    };

// ─── Queue & Worker setup ─────────────────────────────────────────────────────

const QUEUE_NAME = 'playlist-generation' as const;

const generationQueue = new Queue<GeneratePlaylistParams>(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

const generationWorker = new Worker<GeneratePlaylistParams>(
  QUEUE_NAME,
  async (job: Job<GeneratePlaylistParams>) => {
    const { stationId, date, templateId, triggeredBy, userId } = job.data;
    const result = await generatePlaylist({ stationId, date, templateId, triggeredBy, userId });
    return result;
  },
  {
    connection: redisConnection,
    concurrency: 3,
  },
);

generationWorker.on('completed', (job) => {
  console.info(
    `[queueService] Job ${job.id} completed — station=${job.data.stationId} date=${job.data.date}`,
  );
});

generationWorker.on('failed', (job, err) => {
  console.error(
    `[queueService] Job ${job?.id} failed — station=${job?.data.stationId} date=${job?.data.date}`,
    err,
  );
});

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Add a playlist generation job to the queue.
 * Returns the BullMQ job id.
 */
export async function enqueueGeneration(
  params: GeneratePlaylistParams,
): Promise<string> {
  const job = await generationQueue.add('generate', params, {
    jobId: `${params.stationId}:${params.date}:${Date.now()}`,
  });
  if (!job.id) {
    throw new Error('Failed to enqueue generation job: no job id returned');
  }
  return job.id;
}

/**
 * Retrieve job status from BullMQ.
 * Returns null if the job is not found.
 */
export async function getJobStatus(jobId: string): Promise<{
  id: string;
  state: string;
  progress: number | object;
  data: GeneratePlaylistParams;
  returnvalue: unknown;
  failedReason?: string;
} | null> {
  const job = await generationQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  return {
    id: job.id ?? jobId,
    state,
    progress: job.progress as number | object,
    data: job.data,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
  };
}

/**
 * Gracefully close the queue and worker connections.
 */
export async function closeQueue(): Promise<void> {
  await generationWorker.close();
  await generationQueue.close();
}
