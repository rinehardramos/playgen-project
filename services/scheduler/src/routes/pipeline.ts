import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import { getRuns, getRun, createPipelineRun, startStage, retryStage, type PipelineStage } from '../services/pipelineTracker.js';
import { enqueueGeneration, getServiceToken } from '../services/queueService.js';
import { todayInTimezone } from './generateDay.js';
import { getPool } from '../db.js';

interface StationParams { stationId: string }
interface RunParams extends StationParams { runId: string }
interface RetryParams extends RunParams { stage: string }
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

  // Retry a specific failed stage
  app.post<{ Params: RetryParams }>(
    '/stations/:stationId/pipeline/runs/:runId/retry/:stage',
    { preHandler: [authenticate, requirePermission('playlist:write'), requireStationAccess()] },
    async (req, reply) => {
      const { stationId, runId, stage } = req.params;
      const validStages: PipelineStage[] = ['playlist', 'dj_script', 'review', 'tts', 'publish'];
      if (!validStages.includes(stage as PipelineStage)) {
        return reply.status(400).send({ error: `Invalid stage: ${stage}` });
      }

      const run = await getRun(runId);
      if (!run || run.station_id !== stationId) {
        return reply.status(404).send({ error: 'Pipeline run not found' });
      }

      const stageData = run[`stage_${stage}` as keyof typeof run] as Record<string, unknown>;
      if (stageData?.status !== 'failed') {
        return reply.status(400).send({ error: `Stage "${stage}" is not in failed state` });
      }

      // Reset the stage and downstream stages
      await retryStage(runId, stage as PipelineStage);

      // Trigger the appropriate action for each stage
      const djBase = process.env.DJ_INTERNAL_URL ?? 'http://dj:3007';
      const stationBase = process.env.STATION_INTERNAL_URL ?? 'http://station:3002';

      try {
        switch (stage) {
          case 'playlist': {
            await enqueueGeneration({
              stationId,
              date: run.date,
              triggeredBy: 'manual',
              pipelineRunId: runId,
            });
            break;
          }
          case 'dj_script': {
            if (!run.playlist_id) throw new Error('No playlist linked to this run');
            const token = await getServiceToken();
            await fetch(`${djBase}/api/v1/dj/playlists/${run.playlist_id}/generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ pipeline_run_id: runId }),
            });
            break;
          }
          case 'tts': {
            if (!run.script_id) throw new Error('No script linked to this run');
            const token2 = await getServiceToken();
            await fetch(`${djBase}/api/v1/dj/scripts/${run.script_id}/tts?force=true`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token2}` },
            });
            break;
          }
          case 'publish': {
            if (!run.script_id) throw new Error('No script linked to this run');
            const token3 = await getServiceToken();
            await fetch(`${stationBase}/api/v1/programs/${run.script_id}/publish`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token3}` },
            });
            break;
          }
          case 'review':
            // Review is manual — just reset the stage, user approves via UI
            break;
        }
      } catch (err) {
        const { failStage } = await import('../services/pipelineTracker.js');
        await failStage(runId, stage as PipelineStage, String(err));
        return reply.status(500).send({ error: `Retry failed: ${err}` });
      }

      return reply.status(202).send({ run_id: runId, stage, status: 'retrying' });
    },
  );
}
