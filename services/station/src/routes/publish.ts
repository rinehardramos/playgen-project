/**
 * Publish to Production routes
 *
 * POST   /programs/:scriptId/publish        — enqueue publish job
 * GET    /programs/:scriptId/publish/status — current pipeline state
 * POST   /programs/:scriptId/publish/retry  — retry from failed stage
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import { getPool } from '../db';
import { getPublishQueue } from '../queues/publishPipeline';

export async function publishRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // ── Enqueue ──────────────────────────────────────────────────────────────

  app.post<{ Params: { scriptId: string } }>(
    '/programs/:scriptId/publish',
    async (req, reply) => {
      const { scriptId } = req.params;
      const pool = getPool();

      // Verify script belongs to authenticated user's company
      const { rows: scriptRows } = await pool.query<{
        id: string; station_id: string; review_status: string;
        company_id: string;
      }>(
        `SELECT sc.id, sc.station_id, sc.review_status, st.company_id
         FROM dj_scripts sc JOIN stations st ON st.id = sc.station_id
         WHERE sc.id = $1`,
        [scriptId],
      );
      const script = scriptRows[0];
      if (!script) return reply.notFound('Script not found');

      if (!['approved', 'auto_approved'].includes(script.review_status)) {
        return reply.badRequest(
          `Script must be approved before publishing (status: ${script.review_status})`,
        );
      }

      // Enforce one active job per station
      const { rows: activeRows } = await pool.query<{ id: string }>(
        `SELECT id FROM publish_jobs
         WHERE station_id = $1 AND status IN ('queued', 'running')
         LIMIT 1`,
        [script.station_id],
      );
      if (activeRows[0]) {
        return reply.conflict(
          `A publish job is already active for this station (publish_job_id: ${activeRows[0].id})`,
        );
      }

      // Create publish_jobs row
      const { rows: jobRows } = await pool.query<{ id: string }>(
        `INSERT INTO publish_jobs (script_id, station_id, status)
         VALUES ($1, $2, 'queued') RETURNING id`,
        [scriptId, script.station_id],
      );
      const publishJobId = jobRows[0].id;

      // Enqueue BullMQ job
      const queue = getPublishQueue();
      const bullJob = await queue.add(
        'publish',
        { script_id: scriptId, station_id: script.station_id, publish_job_id: publishJobId },
        { jobId: publishJobId }, // deduplication by publish_job_id
      );

      await pool.query(
        `UPDATE publish_jobs SET bull_job_id = $1 WHERE id = $2`,
        [bullJob.id, publishJobId],
      );

      reply.code(202);
      return { publish_job_id: publishJobId, status: 'queued' };
    },
  );

  // ── Status ───────────────────────────────────────────────────────────────

  app.get<{ Params: { scriptId: string } }>(
    '/programs/:scriptId/publish/status',
    async (req, reply) => {
      const { scriptId } = req.params;
      const pool = getPool();

      const { rows } = await pool.query<{
        id: string; status: string; current_stage: string | null;
        stages_completed: Record<string, string>; error_message: string | null;
        created_at: Date; updated_at: Date;
      }>(
        `SELECT id, status, current_stage, stages_completed, error_message, created_at, updated_at
         FROM publish_jobs WHERE script_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [scriptId],
      );

      if (!rows[0]) return reply.notFound('No publish job found for this script');
      return rows[0];
    },
  );

  // ── Retry ────────────────────────────────────────────────────────────────

  app.post<{ Params: { scriptId: string } }>(
    '/programs/:scriptId/publish/retry',
    async (req, reply) => {
      const { scriptId } = req.params;
      const pool = getPool();

      const { rows } = await pool.query<{
        id: string; station_id: string; status: string;
      }>(
        `SELECT id, station_id, status FROM publish_jobs
         WHERE script_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [scriptId],
      );
      const job = rows[0];
      if (!job) return reply.notFound('No publish job found for this script');
      if (job.status !== 'failed') {
        return reply.badRequest(`Job is not in failed state (status: ${job.status})`);
      }

      // Reset to queued — stages_completed is kept so completed stages are skipped
      await pool.query(
        `UPDATE publish_jobs
         SET status = 'queued', current_stage = NULL, error_message = NULL, updated_at = NOW()
         WHERE id = $1`,
        [job.id],
      );

      const queue = getPublishQueue();
      const bullJob = await queue.add(
        'publish',
        { script_id: scriptId, station_id: job.station_id, publish_job_id: job.id },
        { jobId: `${job.id}-retry-${Date.now()}` },
      );

      await pool.query(
        `UPDATE publish_jobs SET bull_job_id = $1 WHERE id = $2`,
        [bullJob.id, job.id],
      );

      reply.code(202);
      return { publish_job_id: job.id, status: 'queued' };
    },
  );
}
