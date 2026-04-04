import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config.js';
import { runGenerationJob } from '../workers/generationWorker.js';

export interface DjGenerationJobData {
  playlist_id: string;
  station_id: string;
  dj_profile_id: string;
  auto_approve: boolean;
  rejection_notes?: string;
}

const QUEUE_NAME = 'dj-generation' as const;

const redisConnection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
      host: config.redis.host,
      port: config.redis.port,
      ...(config.redis.password ? { password: config.redis.password } : {}),
    };

const djQueue = new Queue<DjGenerationJobData>(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

const djWorker = new Worker<DjGenerationJobData>(
  QUEUE_NAME,
  async (job: Job<DjGenerationJobData>) => runGenerationJob(job.data),
  { connection: redisConnection, concurrency: 2 },
);

djWorker.on('completed', (job) => {
  console.info(`[djQueue] Job ${job.id} completed — playlist=${job.data.playlist_id}`);
});

djWorker.on('failed', (job, err) => {
  console.error(`[djQueue] Job ${job?.id} failed — playlist=${job?.data.playlist_id}`, err);
});

export async function enqueueDjGeneration(data: DjGenerationJobData): Promise<string> {
  const job = await djQueue.add('generate-script', data, {
    jobId: `dj:${data.playlist_id}:${Date.now()}`,
  });
  if (!job.id) throw new Error('Failed to enqueue DJ generation job');
  return job.id;
}

export async function closeQueue(): Promise<void> {
  await djWorker.close();
  await djQueue.close();
}
