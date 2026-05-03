import type { FastifyInstance } from 'fastify';
import { getPool } from '../db';
import { getRadioPipelineQueue, type RadioPipelineJobData } from '../queues/radioPipeline';

interface StationParams {
  id: string;
}

interface RunParams {
  id: string;
  runId: string;
}

interface RetryParams {
  id: string;
  runId: string;
  stageName: string;
}

interface TriggerBody {
  date?: string;
  dj_profile_id?: string;
  secondary_dj_profile_id?: string;
  tertiary_dj_profile_id?: string;
  voice_map?: Record<string, string>;
  auto_approve?: boolean;
  publish?: boolean;
}

interface ListQuery {
  limit?: number;
}

/** Ordered stage names — used for retry to determine which stages to clear. */
const STAGE_ORDER = ['generate_playlist', 'generate_script', 'generate_tts', 'publish'] as const;
type StageName = typeof STAGE_ORDER[number];

/** Maps stage name to per-stage JSONB column name. */
const STAGE_COLUMN: Record<StageName, string> = {
  generate_playlist: 'stage_playlist',
  generate_script: 'stage_dj_script',
  generate_tts: 'stage_tts',
  publish: 'stage_publish',
};

export default async function radioPipelineRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: StationParams; Body: TriggerBody }>(
    '/stations/:id/pipeline/trigger',
    async (req, reply) => {
      const { id: station_id } = req.params;
      const {
        dj_profile_id,
        secondary_dj_profile_id,
        tertiary_dj_profile_id,
        voice_map,
        auto_approve,
        publish,
      } = req.body ?? {};

      const pool = getPool();

      const { rows: stationRows } = await pool.query<{ timezone: string }>(
        `SELECT timezone FROM stations WHERE id = $1`,
        [station_id],
      );
      if (!stationRows[0]) return reply.notFound('Station not found');

      const date = req.body?.date ?? new Date().toLocaleDateString('en-CA', {
        timeZone: stationRows[0].timezone,
      });

      const { rows: activeRows } = await pool.query<{ id: string }>(
        `SELECT id FROM pipeline_runs
         WHERE station_id = $1 AND status IN ('queued', 'running')
         LIMIT 1`,
        [station_id],
      );
      if (activeRows[0]) {
        return reply.conflict(
          `An active pipeline run already exists for this station (pipeline_run_id: ${activeRows[0].id})`,
        );
      }

      const config = JSON.stringify({
        dj_profile_id,
        secondary_dj_profile_id,
        tertiary_dj_profile_id,
        voice_map,
        auto_approve,
        publish,
        date,
      });

      const { rows: runRows } = await pool.query<{ id: string }>(
        `INSERT INTO pipeline_runs (station_id, date, status, config)
         VALUES ($1, $2, 'queued', $3) RETURNING id`,
        [station_id, date, config],
      );
      const pipeline_run_id = runRows[0].id;

      const queue = getRadioPipelineQueue();
      const jobData: RadioPipelineJobData = { station_id, pipeline_run_id };
      await queue.add('pipeline', jobData, {
        jobId: `pipeline:${station_id}:${Date.now()}`,
      });

      reply.code(202);
      return { pipeline_run_id, status: 'queued' };
    },
  );

  app.get<{ Params: StationParams; Querystring: ListQuery }>(
    '/stations/:id/pipeline/runs',
    async (req, _reply) => {
      const { id: station_id } = req.params;
      const limit = Math.min(req.query.limit ?? 10, 50);
      const pool = getPool();

      const [{ rows }, { rows: countRows }] = await Promise.all([
        pool.query(
          `SELECT * FROM pipeline_runs
           WHERE station_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [station_id, limit],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::int AS count FROM pipeline_runs WHERE station_id = $1`,
          [station_id],
        ),
      ]);

      return { runs: rows, total: Number(countRows[0]?.count ?? 0) };
    },
  );

  app.get<{ Params: RunParams }>(
    '/stations/:id/pipeline/runs/:runId',
    async (req, reply) => {
      const { id: station_id, runId } = req.params;
      const pool = getPool();

      const { rows } = await pool.query(
        `SELECT * FROM pipeline_runs WHERE id = $1 AND station_id = $2`,
        [runId, station_id],
      );

      if (!rows[0]) return reply.notFound('Pipeline run not found');
      return rows[0];
    },
  );

  app.post<{ Params: RetryParams }>(
    '/stations/:id/pipeline/runs/:runId/retry/:stageName',
    async (req, reply) => {
      const { id: station_id, runId, stageName } = req.params;

      const stageIdx = STAGE_ORDER.indexOf(stageName as StageName);
      if (stageIdx === -1) return reply.badRequest(`Unknown stage: ${stageName}`);

      const pool = getPool();
      const { rows } = await pool.query<{
        id: string;
        status: string;
        stages_completed: Record<string, unknown>;
      }>(
        `SELECT id, status, stages_completed FROM pipeline_runs WHERE id = $1 AND station_id = $2`,
        [runId, station_id],
      );
      const run = rows[0];
      if (!run) return reply.notFound('Pipeline run not found');
      if (run.status === 'running') return reply.conflict('Cannot retry a running pipeline');

      // Clear the retried stage and all subsequent stages from stages_completed
      const stagesToClear = STAGE_ORDER.slice(stageIdx);
      const stagesCompleted = { ...(run.stages_completed as Record<string, unknown>) };
      for (const s of stagesToClear) {
        delete stagesCompleted[s];
      }

      // Build SET clause to reset per-stage columns back to pending
      const stageCols = stagesToClear
        .map((s) => `${STAGE_COLUMN[s]} = '{"status":"pending"}'::jsonb`)
        .join(', ');

      await pool.query(
        `UPDATE pipeline_runs
         SET status = 'queued', stages_completed = $1, ${stageCols}, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(stagesCompleted), runId],
      );

      const queue = getRadioPipelineQueue();
      await queue.add('pipeline', { station_id, pipeline_run_id: runId }, {
        jobId: `pipeline:${station_id}:${Date.now()}`,
      });

      reply.code(202);
      return { pipeline_run_id: runId, stage: stageName, status: 'queued' };
    },
  );
}
