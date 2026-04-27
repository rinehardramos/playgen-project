/**
 * Radio Program Factory pipeline — BullMQ queue + 4-stage worker.
 *
 * Stages (in order):
 *   1. generate_playlist — POST to scheduler; poll until playlist job completes
 *   2. generate_script   — POST to DJ service; poll until script + generation_ms set
 *   3. generate_tts      — poll DJ segments until all have audio_url (skipped if !auto_approve)
 *   4. publish           — enqueue publish job; poll until completed (skipped if !config.publish)
 *
 * Required env vars:
 *   REDIS_URL              — BullMQ backing store
 *   SCHEDULER_INTERNAL_URL — defaults to http://scheduler:3004
 *   DJ_INTERNAL_URL        — defaults to http://dj:3007
 *   AUTH_INTERNAL_URL      — defaults to http://auth:3001
 *   ADMIN_EMAIL            — service account for internal auth
 *   ADMIN_PASSWORD         — service account password
 */

import { Queue, Worker, type Job } from 'bullmq';
import { getPool } from '../db';
import { getPublishQueue } from './publishPipeline';

// ── Constants ─────────────────────────────────────────────────────────────────

export const RADIO_PIPELINE_QUEUE = 'radio-pipeline';

const SCHEDULER_URL = () => process.env.SCHEDULER_INTERNAL_URL ?? 'http://scheduler:3004';
const DJ_URL = () => process.env.DJ_INTERNAL_URL ?? 'http://dj:3007';
const AUTH_URL = () => process.env.AUTH_INTERNAL_URL ?? 'http://auth:3001';

// ── Job data interface ────────────────────────────────────────────────────────

export interface RadioPipelineJobData {
  station_id: string;
  pipeline_run_id: string;
}

// ── Config shape (stored in pipeline_runs.config) ────────────────────────────

interface PipelineConfig {
  dj_profile_id?: string;
  secondary_dj_profile_id?: string;
  voice_map?: Record<string, string>;
  auto_approve?: boolean;
  publish?: boolean;
  date?: string;
}

// ── Queue (lazy singleton) ────────────────────────────────────────────────────

let _queue: Queue<RadioPipelineJobData> | null = null;

export function getRadioPipelineQueue(): Queue<RadioPipelineJobData> {
  if (!_queue) {
    _queue = new Queue<RadioPipelineJobData>(RADIO_PIPELINE_QUEUE, {
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
  }
  return _queue;
}

// ── Service token helper (deduplicated, 10-min cache) ─────────────────────────

let _cachedToken: string | null = null;
let _cachedTokenExpiry = 0;
const TOKEN_CACHE_MS = 10 * 60 * 1000;
let _tokenFetchPromise: Promise<string> | null = null;

async function getServiceToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedTokenExpiry) return _cachedToken;

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
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD env vars required for radio pipeline');
  }

  const res = await fetch(`${AUTH_URL()}/api/v1/auth/login`, {
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

// ── DB helpers ────────────────────────────────────────────────────────────────

async function setStage(runId: string, stage: string): Promise<void> {
  await getPool().query(
    `UPDATE pipeline_runs SET current_stage = $1, status = 'running', updated_at = NOW()
     WHERE id = $2`,
    [stage, runId],
  );
}

async function completeStage(runId: string, stage: string, result: Record<string, unknown>): Promise<void> {
  await getPool().query(
    `UPDATE pipeline_runs
     SET stages_completed = stages_completed || jsonb_build_object($1::text, $2::jsonb),
         updated_at = NOW()
     WHERE id = $3`,
    [stage, JSON.stringify(result), runId],
  );
}

async function failRun(runId: string, message: string): Promise<void> {
  await getPool().query(
    `UPDATE pipeline_runs SET status = 'failed', error_message = $1, updated_at = NOW()
     WHERE id = $2`,
    [message, runId],
  );
}

// ── Polling helpers ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a URL with GET until predicate returns a non-null value or timeout.
 * Returns the extracted value on success; throws on timeout.
 */
async function pollUntil<T>(
  urlOrNull: string | null,
  token: string,
  predicate: ((body: unknown) => T | null) | (() => Promise<T | null>),
  intervalMs: number,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let result: T | null;
    if (urlOrNull) {
      const res = await fetch(urlOrNull, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`${label}: poll GET ${urlOrNull} returned ${res.status}`);
      const body = await res.json();
      result = (predicate as (body: unknown) => T | null)(body);
    } else {
      result = await (predicate as () => Promise<T | null>)();
    }
    if (result !== null) return result;
    await sleep(intervalMs);
  }
  throw new Error(`${label}: timed out after ${timeoutMs / 1000}s`);
}

// ── Stage implementations ─────────────────────────────────────────────────────

async function stageGeneratePlaylist(
  runId: string,
  stationId: string,
  date: string,
  token: string,
): Promise<string> {
  // Trigger generation
  const triggerRes = await fetch(
    `${SCHEDULER_URL()}/api/v1/stations/${stationId}/playlists/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ date }),
    },
  );
  if (!triggerRes.ok) {
    const body = await triggerRes.text();
    throw new Error(`generate_playlist: scheduler returned ${triggerRes.status}: ${body}`);
  }
  const triggerData = await triggerRes.json() as { job_id: string };
  const jobId = triggerData.job_id;
  if (!jobId) throw new Error('generate_playlist: scheduler did not return job_id');

  // Poll the playlists table directly (shared DB) instead of the scheduler's
  // job status API which requires UUID-format job IDs and auth.
  const pool = getPool();
  const playlistId = await pollUntil<string>(
    null, // no URL — we poll the DB
    token,
    async () => {
      const { rows } = await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM playlists WHERE station_id = $1 AND date = $2 ORDER BY generated_at DESC NULLS LAST LIMIT 1`,
        [stationId, date],
      );
      const pl = rows[0];
      if (!pl) return null;
      if (pl.status === 'failed') throw new Error('generate_playlist: playlist generation failed');
      if (pl.status === 'ready' || pl.status === 'approved') return pl.id;
      return null; // still generating
    },
    3000,
    120_000,
    'generate_playlist',
  );

  // Persist playlist_id on the run row
  await getPool().query(
    `UPDATE pipeline_runs SET playlist_id = $1, updated_at = NOW() WHERE id = $2`,
    [playlistId, runId],
  );

  return playlistId;
}

async function stageGenerateScript(
  runId: string,
  playlistId: string,
  config: PipelineConfig,
  token: string,
): Promise<string> {
  const { dj_profile_id, secondary_dj_profile_id, voice_map, auto_approve } = config;

  const triggerRes = await fetch(
    `${DJ_URL()}/api/v1/dj/playlists/${playlistId}/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ dj_profile_id, secondary_dj_profile_id, voice_map, auto_approve }),
    },
  );
  if (!triggerRes.ok) {
    const body = await triggerRes.text();
    throw new Error(`generate_script: DJ service returned ${triggerRes.status}: ${body}`);
  }
  const triggerData = await triggerRes.json() as { job_id?: string };
  if (!triggerData.job_id) throw new Error('generate_script: DJ service did not return job_id');

  // Poll until script exists AND generation_ms is set (max 300s, every 5s)
  const scriptId = await pollUntil<string>(
    `${DJ_URL()}/api/v1/dj/playlists/${playlistId}/script`,
    token,
    (body) => {
      const b = body as { id?: string; generation_ms?: number | null } | null;
      if (b?.id && b.generation_ms != null) return b.id;
      return null;
    },
    5000,
    300_000,
    'generate_script',
  );

  // Persist script_id on the run row
  await getPool().query(
    `UPDATE pipeline_runs SET script_id = $1, updated_at = NOW() WHERE id = $2`,
    [scriptId, runId],
  );

  return scriptId;
}

async function stageGenerateTts(scriptId: string, token: string): Promise<void> {
  // TTS is auto-triggered by the DJ worker when auto_approve=true.
  // We simply poll until all segments have a non-empty audio_url (max 300s, every 5s).
  await pollUntil<true>(
    `${DJ_URL()}/api/v1/dj/scripts/${scriptId}`,
    token,
    (body) => {
      const b = body as { segments?: Array<{ audio_url?: string | null }> } | null;
      if (!b?.segments || b.segments.length === 0) return null;
      const allDone = b.segments.every((s) => s.audio_url != null && s.audio_url !== '');
      return allDone ? true : null;
    },
    5000,
    300_000,
    'generate_tts',
  );
}

async function stagePublish(
  stationId: string,
  scriptId: string,
  token: string,
): Promise<void> {
  const pool = getPool();

  // Insert a publish_jobs row
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO publish_jobs (station_id, script_id, status, stages_completed)
     VALUES ($1, $2, 'queued', '{}')
     RETURNING id`,
    [stationId, scriptId],
  );
  const publishJobId = rows[0]?.id;
  if (!publishJobId) throw new Error('publish: failed to insert publish_jobs row');

  // Enqueue in publish pipeline
  const publishQueue = getPublishQueue();
  const bullJob = await publishQueue.add('publish', {
    script_id: scriptId,
    station_id: stationId,
    publish_job_id: publishJobId,
  });

  console.info(`[radio-pipeline] publish job enqueued — bull_job_id=${bullJob.id} publish_job_id=${publishJobId}`);

  // Poll publish_jobs row until completed or failed (max 300s, every 5s)
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const { rows: statusRows } = await pool.query<{ status: string; error_message: string | null }>(
      `SELECT status, error_message FROM publish_jobs WHERE id = $1`,
      [publishJobId],
    );
    const row = statusRows[0];
    if (!row) throw new Error('publish: publish_jobs row disappeared');
    if (row.status === 'completed') return;
    if (row.status === 'failed') {
      throw new Error(`publish: publish job failed — ${row.error_message ?? 'unknown'}`);
    }
    await sleep(5000);
  }
  throw new Error('publish: timed out after 300s waiting for publish job to complete');
}

// ── Worker ────────────────────────────────────────────────────────────────────

export function startRadioPipelineWorker(): Worker<RadioPipelineJobData> {
  const worker = new Worker<RadioPipelineJobData>(
    RADIO_PIPELINE_QUEUE,
    async (job: Job<RadioPipelineJobData>) => {
      const { station_id, pipeline_run_id } = job.data;
      const pool = getPool();

      // Load run config and stages_completed for resumability
      const { rows } = await pool.query<{
        config: PipelineConfig;
        stages_completed: Record<string, unknown>;
        playlist_id: string | null;
        script_id: string | null;
      }>(
        `SELECT config, stages_completed, playlist_id, script_id FROM pipeline_runs WHERE id = $1`,
        [pipeline_run_id],
      );
      const run = rows[0];
      if (!run) throw new Error(`pipeline_run ${pipeline_run_id} not found`);

      const { config, stages_completed: done } = run;
      const date = config.date ?? new Date().toISOString().split('T')[0];

      const token = await getServiceToken();

      // ── Stage 1: generate_playlist ──────────────────────────────────────────
      let playlistId = run.playlist_id ?? '';
      if (!done.generate_playlist) {
        await setStage(pipeline_run_id, 'generate_playlist');
        const start = Date.now();
        playlistId = await stageGeneratePlaylist(pipeline_run_id, station_id, date, token);
        await completeStage(pipeline_run_id, 'generate_playlist', {
          playlist_id: playlistId,
          duration_ms: Date.now() - start,
        });
      }

      // ── Stage 2: generate_script ────────────────────────────────────────────
      let scriptId = run.script_id ?? '';
      if (!done.generate_script) {
        await setStage(pipeline_run_id, 'generate_script');
        const start = Date.now();
        scriptId = await stageGenerateScript(pipeline_run_id, playlistId, config, token);
        await completeStage(pipeline_run_id, 'generate_script', {
          script_id: scriptId,
          duration_ms: Date.now() - start,
        });
      }

      // ── Stage 3: generate_tts ───────────────────────────────────────────────
      if (!done.generate_tts) {
        if (config.auto_approve) {
          await setStage(pipeline_run_id, 'generate_tts');
          const start = Date.now();
          await stageGenerateTts(scriptId, token);
          await completeStage(pipeline_run_id, 'generate_tts', { duration_ms: Date.now() - start });
        } else {
          await completeStage(pipeline_run_id, 'generate_tts', { skipped: true });
        }
      }

      // ── Stage 4: publish ────────────────────────────────────────────────────
      if (!done.publish) {
        if (config.publish) {
          await setStage(pipeline_run_id, 'publish');
          const start = Date.now();
          await stagePublish(station_id, scriptId, token);
          await completeStage(pipeline_run_id, 'publish', { duration_ms: Date.now() - start });
        } else {
          await completeStage(pipeline_run_id, 'publish', { skipped: true });
        }
      }

      // Mark run completed
      await pool.query(
        `UPDATE pipeline_runs SET status = 'completed', current_stage = NULL, updated_at = NOW()
         WHERE id = $1`,
        [pipeline_run_id],
      );

      console.info(
        `[radio-pipeline] run ${pipeline_run_id} completed — station=${station_id} date=${date}`,
      );
    },
    {
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
      concurrency: 1,
    },
  );

  worker.on('failed', async (job, err) => {
    if (job) {
      await failRun(job.data.pipeline_run_id, err.message).catch(() => {});
    }
  });

  return worker;
}
