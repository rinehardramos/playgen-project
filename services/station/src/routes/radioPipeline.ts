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
  offset?: number;
}

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
        `INSERT INTO pipeline_runs (station_id, date, status, config, triggered_by)
         VALUES ($1, $2, 'queued', $3, 'manual') RETURNING id`,
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
      const limit = Math.min(req.query.limit ?? 20, 100);
      const offset = req.query.offset ?? 0;
      const pool = getPool();

      const [dataRes, countRes] = await Promise.all([
        pool.query(
          `SELECT * FROM pipeline_runs
           WHERE station_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [station_id, limit, offset],
        ),
        pool.query<{ count: string }>(
          `SELECT COUNT(*) FROM pipeline_runs WHERE station_id = $1`,
          [station_id],
        ),
      ]);

      return { runs: dataRes.rows, total: Number(countRes.rows[0].count) };
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
}
