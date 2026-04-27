import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import { getRuns, getRun, createPipelineRun, startStage } from '../services/pipelineTracker.js';
import { enqueueGeneration } from '../services/queueService.js';
import { todayInTimezone } from './generateDay.js';
import { getPool } from '../db.js';

interface StationParams { stationId: string }
interface RunParams extends StationParams { runId: string }
interface TriggerBody { date?: string }

export async function pipelineRoutes(app: FastifyInstance) {
  // List pipeline runs for a station
  app.get<{ Params: StationParams; Querystring: { limit?: string; offset?: string } }>(
    '/stations/:stationId/pipeline/runs',
    { preHandler: [authenticate, requirePermission('playlist:read'), requireStationAccess()] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 20), 100);
      const offset = Number(req.query.offset ?? 0);
      const result = await getRuns(req.params.stationId, limit, offset);
      return reply.send(result);
    },
  );

  // Get single pipeline run
  app.get<{ Params: RunParams }>(
    '/stations/:stationId/pipeline/runs/:runId',
    { preHandler: [authenticate, requirePermission('playlist:read'), requireStationAccess()] },
    async (req, reply) => {
      const run = await getRun(req.params.runId);
      if (!run || run.station_id !== req.params.stationId) {
        return reply.status(404).send({ error: 'Pipeline run not found' });
      }
      return reply.send(run);
    },
  );

  // Get latest pipeline run for a station
  app.get<{ Params: StationParams }>(
    '/stations/:stationId/pipeline/runs/latest',
    { preHandler: [authenticate, requirePermission('playlist:read'), requireStationAccess()] },
    async (req, reply) => {
      const result = await getRuns(req.params.stationId, 1, 0);
      if (result.runs.length === 0) {
        return reply.status(404).send({ error: 'No pipeline runs found' });
      }
      return reply.send(result.runs[0]);
    },
  );

  // Trigger a new pipeline run
  app.post<{ Params: StationParams; Body: TriggerBody }>(
    '/stations/:stationId/pipeline/trigger',
    { preHandler: [authenticate, requirePermission('playlist:write'), requireStationAccess()] },
    async (req, reply) => {
      const pool = getPool();
      const { stationId } = req.params;

      // Resolve date
      const { rows: stationRows } = await pool.query<{ timezone: string | null }>(
        'SELECT timezone FROM stations WHERE id = $1', [stationId],
      );
      if (!stationRows[0]) return reply.status(404).send({ error: 'Station not found' });
      const date = req.body?.date ?? todayInTimezone(stationRows[0].timezone);

      // Create pipeline run
      const runId = await createPipelineRun(stationId, date, 'manual');

      // Enqueue playlist generation (the pipeline takes over from here)
      const jobId = await enqueueGeneration({
        stationId,
        date,
        triggeredBy: 'manual',
        pipelineRunId: runId,
      });

      return reply.status(202).send({
        run_id: runId,
        job_id: jobId,
        date,
        status: 'running',
      });
    },
  );
}
