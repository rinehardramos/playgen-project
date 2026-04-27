import { Queue, Worker, Job } from 'bullmq';
import { generatePlaylist, GeneratePlaylistParams, GeneratePlaylistResult } from './generationEngine';
import { getPool } from '../db';

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
  const result = job.returnvalue as GeneratePlaylistResult | undefined;
  const runId = job.data.pipelineRunId;
  console.info(
    `[queueService] Job ${job.id} completed — station=${job.data.stationId} date=${job.data.date} playlist=${result?.playlistId}`,
  );

  // Update pipeline run if tracked
  if (runId && result?.playlistId) {
    import('./pipelineTracker.js').then(({ completeStage, linkResource, startStage }) => {
      completeStage(runId, 'playlist', { metadata: { playlist_id: result.playlistId } }).catch(() => {});
      linkResource(runId, 'playlist_id', result.playlistId).catch(() => {});
      startStage(runId, 'dj_script').catch(() => {});
    }).catch(() => {});
  }

  if (result?.playlistId) {
    triggerDjPipeline(job.data.stationId, result.playlistId, runId).catch((err) =>
      console.error(`[queueService] DJ auto-trigger failed for playlist ${result.playlistId}`, err),
    );
  }
});

generationWorker.on('failed', (job, err) => {
  console.error(
    `[queueService] Job ${job?.id} failed — station=${job?.data.stationId} date=${job?.data.date}`,
    err,
  );

  // Update pipeline run if tracked
  const runId = job?.data.pipelineRunId;
  if (runId) {
    import('./pipelineTracker.js').then(({ failStage }) => {
      failStage(runId, 'playlist', String(err)).catch(() => {});
    }).catch(() => {});
  }
});

// ─── Auto-trigger DJ pipeline ─────────────────────────────────────────────────

/**
 * Get a JWT token for internal service-to-service calls.
 * Cached for 10 minutes to prevent concurrent auth race conditions (#496).
 */
let _cachedToken: string | null = null;
let _cachedTokenExpiry = 0;
const TOKEN_CACHE_MS = 10 * 60 * 1000;
let _tokenFetchPromise: Promise<string> | null = null;

export async function getServiceToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedTokenExpiry) return _cachedToken;

  // Deduplicate concurrent requests — share a single in-flight fetch
  if (_tokenFetchPromise) return _tokenFetchPromise;

  _tokenFetchPromise = fetchServiceToken();
  try {
    const token = await _tokenFetchPromise;
    _cachedToken = token;
    _cachedTokenExpiry = Date.now() + TOKEN_CACHE_MS;
    return token;
  } finally {
    _tokenFetchPromise = null;
  }
}

async function fetchServiceToken(): Promise<string> {
  const authBase = process.env.AUTH_INTERNAL_URL ?? 'http://auth:3001';
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD env vars required for auto-pipeline');
  }

  const res = await fetch(`${authBase}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Service login failed: ${res.status}`);
  const data = await res.json() as { tokens?: { access_token: string }; access_token?: string };
  const token = data.tokens?.access_token ?? data.access_token;
  if (!token) throw new Error('Service login response missing access_token');
  return token;
}

/**
 * After playlist generation succeeds, check if the station has DJ enabled
 * and auto-trigger DJ script generation + song audio sourcing.
 */
async function triggerDjPipeline(stationId: string, playlistId: string, pipelineRunId?: string): Promise<void> {
  const pool = getPool();

  const { rows } = await pool.query<{
    dj_enabled: boolean;
    dj_auto_approve: boolean;
  }>(`SELECT dj_enabled, dj_auto_approve FROM stations WHERE id = $1`, [stationId]);

  const station = rows[0];
  if (!station?.dj_enabled) return;

  const djBase = process.env.DJ_INTERNAL_URL ?? 'http://dj:3007';
  const token = await getServiceToken();

  // Trigger DJ script generation
  console.info(`[auto-pipeline] Triggering DJ script generation for playlist ${playlistId}`);
  const res = await fetch(`${djBase}/api/v1/dj/playlists/${playlistId}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ auto_approve: station.dj_auto_approve, pipeline_run_id: pipelineRunId }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[auto-pipeline] DJ generate failed (${res.status}): ${body}`);
    return;
  }

  const data = await res.json() as { job_id?: string };
  console.info(`[auto-pipeline] DJ generation enqueued — job=${data.job_id}`);

  // Fire-and-forget: trigger song audio sourcing via info-broker
  triggerSongSourcing(stationId, playlistId).catch((err) =>
    console.warn('[auto-pipeline] Song sourcing trigger failed (non-fatal)', err),
  );
}

/**
 * Ask info-broker to source audio for songs in this playlist that lack audio_url.
 * Fire-and-forget — never blocks the pipeline.
 */
async function triggerSongSourcing(stationId: string, playlistId: string): Promise<void> {
  const infoBrokerUrl = process.env.INFO_BROKER_URL ?? process.env.INFO_BROKER_BASE_URL;
  const apiKey = process.env.INFO_BROKER_API_KEY;
  if (!infoBrokerUrl || !apiKey) return;

  const pool = getPool();
  const { rows: songs } = await pool.query<{ song_id: string; title: string; artist: string }>(
    `SELECT s.id AS song_id, s.title, s.artist
     FROM playlist_entries pe JOIN songs s ON s.id = pe.song_id
     WHERE pe.playlist_id = $1 AND (s.audio_url IS NULL OR s.audio_url = '')`,
    [playlistId],
  );

  if (songs.length === 0) return;

  const callbackBase = process.env.PROD_GATEWAY_URL ?? process.env.GATEWAY_URL ?? 'http://gateway:80';
  console.info(`[auto-pipeline] Sourcing audio for ${songs.length} songs via info-broker`);

  await fetch(`${infoBrokerUrl}/v1/playlists/source-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({
      station_id: stationId,
      songs,
      callback_url: `${callbackBase}/api/v1/internal/songs/audio-sourced`,
    }),
  });
}

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
