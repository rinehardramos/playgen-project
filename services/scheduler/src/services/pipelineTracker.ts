/**
 * pipelineTracker.ts
 *
 * Tracks end-to-end Radio Program Factory pipeline runs.
 * Each run has 5 stages: playlist → dj_script → review → tts → publish.
 * Stage state is stored as JSONB in the pipeline_runs table.
 */

import { getPool } from '../db.js';

export type PipelineStage = 'playlist' | 'dj_script' | 'review' | 'tts' | 'publish';
export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StageUpdate {
  status?: StageStatus;
  started_at?: string;
  completed_at?: string;
  error?: string | null;
  progress?: number;
  step?: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineRun {
  id: string;
  station_id: string;
  playlist_id: string | null;
  script_id: string | null;
  date: string;
  status: string;
  triggered_by: string;
  stage_playlist: Record<string, unknown>;
  stage_dj_script: Record<string, unknown>;
  stage_review: Record<string, unknown>;
  stage_tts: Record<string, unknown>;
  stage_publish: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const STAGE_COLUMN: Record<PipelineStage, string> = {
  playlist: 'stage_playlist',
  dj_script: 'stage_dj_script',
  review: 'stage_review',
  tts: 'stage_tts',
  publish: 'stage_publish',
};

/**
 * Create a new pipeline run. Returns the run ID.
 */
export async function createPipelineRun(
  stationId: string,
  date: string,
  triggeredBy: 'manual' | 'cron' | 'auto' = 'manual',
): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pipeline_runs (station_id, date, triggered_by, stage_playlist)
     VALUES ($1, $2, $3, '{"status":"running","started_at":"' || NOW()::text || '"}'::jsonb)
     RETURNING id`,
    [stationId, date, triggeredBy],
  );
  return rows[0].id;
}

/**
 * Update a single stage's JSONB by merging the update into the existing value.
 */
export async function updateStage(
  runId: string,
  stage: PipelineStage,
  update: StageUpdate,
): Promise<void> {
  const pool = getPool();
  const col = STAGE_COLUMN[stage];
  await pool.query(
    `UPDATE pipeline_runs
     SET ${col} = ${col} || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(update), runId],
  );
}

/**
 * Set a stage to running with started_at timestamp.
 */
export async function startStage(runId: string, stage: PipelineStage, metadata?: Record<string, unknown>): Promise<void> {
  await updateStage(runId, stage, {
    status: 'running',
    started_at: new Date().toISOString(),
    ...(metadata ? { metadata } : {}),
  });
}

/**
 * Set a stage to completed with completed_at timestamp.
 */
export async function completeStage(runId: string, stage: PipelineStage, metadata?: Record<string, unknown>): Promise<void> {
  await updateStage(runId, stage, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    progress: 100,
    error: null,
    ...(metadata ? { metadata } : {}),
  });
}

/**
 * Set a stage to failed with error message.
 */
export async function failStage(runId: string, stage: PipelineStage, error: string): Promise<void> {
  await updateStage(runId, stage, {
    status: 'failed',
    completed_at: new Date().toISOString(),
    error,
  });
  // Also fail the overall run
  const pool = getPool();
  await pool.query(
    `UPDATE pipeline_runs SET status = 'failed', updated_at = NOW() WHERE id = $1`,
    [runId],
  );
}

/**
 * Link a playlist or script to the run.
 */
export async function linkResource(
  runId: string,
  field: 'playlist_id' | 'script_id',
  resourceId: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE pipeline_runs SET ${field} = $1, updated_at = NOW() WHERE id = $2`,
    [resourceId, runId],
  );
}

/**
 * Mark the overall run as completed.
 */
export async function completeRun(runId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE pipeline_runs SET status = 'completed', updated_at = NOW() WHERE id = $1`,
    [runId],
  );
}

/**
 * Get a single pipeline run by ID.
 */
export async function getRun(runId: string): Promise<PipelineRun | null> {
  const pool = getPool();
  const { rows } = await pool.query<PipelineRun>(
    `SELECT * FROM pipeline_runs WHERE id = $1`,
    [runId],
  );
  return rows[0] ?? null;
}

/**
 * List pipeline runs for a station, most recent first.
 */
export async function getRuns(
  stationId: string,
  limit = 20,
  offset = 0,
): Promise<{ runs: PipelineRun[]; total: number }> {
  const pool = getPool();
  const [dataRes, countRes] = await Promise.all([
    pool.query<PipelineRun>(
      `SELECT * FROM pipeline_runs WHERE station_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [stationId, limit, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM pipeline_runs WHERE station_id = $1`,
      [stationId],
    ),
  ]);
  return { runs: dataRes.rows, total: Number(countRes.rows[0].count) };
}

/**
 * Find the active (running) pipeline run for a station+date, if any.
 */
export async function findActiveRun(stationId: string, date: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM pipeline_runs WHERE station_id = $1 AND date = $2 AND status = 'running' LIMIT 1`,
    [stationId, date],
  );
  return rows[0]?.id ?? null;
}
