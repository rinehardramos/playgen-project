import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  authenticate,
  requirePermission,
  requireStationAccess,
} from '@playgen/middleware';
import { getPool } from '../db';
import { enqueueGeneration } from '../services/queueService';

// ─── Request body / param types ───────────────────────────────────────────────

interface GenerateBody {
  date: string;
  template_id?: string;
}

interface StationParams {
  id: string;
}

interface JobParams {
  id: string;
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function schedulerRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /stations/:id/playlists/generate ────────────────────────────────
  app.post<{ Params: StationParams; Body: GenerateBody }>(
    '/stations/:id/playlists/generate',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['date'],
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            template_id: { type: 'string', format: 'uuid' },
          },
        },
      },
      preHandler: [
        authenticate,
        requirePermission('playlist:write'),
        requireStationAccess(),
      ],
    },
    async (req: FastifyRequest<{ Params: StationParams; Body: GenerateBody }>, reply: FastifyReply) => {
      const stationId = req.params.id;
      const { date, template_id: templateId } = req.body;
      const userId = req.user.sub;

      // Check for pre-existing playlist in terminal states so we can return
      // the playlist_id without re-enqueueing if appropriate.
      const pool = getPool();
      const existingRes = await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM playlists WHERE station_id = $1 AND date = $2`,
        [stationId, date],
      );

      if (existingRes.rows.length > 0) {
        const { status } = existingRes.rows[0];
        if (status === 'approved') {
          return reply.code(409).send({
            error: { code: 'CONFLICT', message: 'Playlist already approved' },
          });
        }
        if (status === 'generating') {
          return reply.code(409).send({
            error: { code: 'CONFLICT', message: 'Playlist is already being generated' },
          });
        }
      }

      const jobId = await enqueueGeneration({
        stationId,
        date,
        templateId,
        triggeredBy: 'manual',
        userId,
      });

      // Retrieve the playlist id that was created (may not exist yet if the
      // worker hasn't started — return null and let caller poll).
      const playlistRes = await pool.query<{ id: string }>(
        `SELECT id FROM playlists WHERE station_id = $1 AND date = $2`,
        [stationId, date],
      );
      const playlistId = playlistRes.rows[0]?.id ?? null;

      return reply.code(202).send({ job_id: jobId, playlist_id: playlistId });
    },
  );

  // ── POST /stations/:id/playlists/generate/month — batch for a whole month ──
  app.post<{ Params: StationParams; Body: { year: number; month: number; template_id?: string } }>(
    '/stations/:id/playlists/generate/month',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['year', 'month'],
          properties: {
            year: { type: 'integer', minimum: 2000, maximum: 2100 },
            month: { type: 'integer', minimum: 1, maximum: 12 },
            template_id: { type: 'string', format: 'uuid' },
          },
        },
      },
      preHandler: [
        authenticate,
        requirePermission('playlist:write'),
        requireStationAccess(),
      ],
    },
    async (req: FastifyRequest<{ Params: StationParams; Body: { year: number; month: number; template_id?: string } }>, reply: FastifyReply) => {
      const stationId = req.params.id;
      const { year, month, template_id: templateId } = req.body;
      const userId = req.user.sub;

      const daysInMonth = new Date(year, month, 0).getDate();
      const jobs: { date: string; job_id: string }[] = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        try {
          const jobId = await enqueueGeneration({ stationId, date, templateId, triggeredBy: 'manual', userId });
          jobs.push({ date, job_id: jobId });
        } catch {
          // Skip days that are already approved or generating — continue with others
        }
      }

      return reply.code(202).send({ queued: jobs.length, jobs });
    },
  );

  // ── GET /stations/:id/generation-failures ────────────────────────────────
  app.get<{ Params: StationParams }>(
    '/stations/:id/generation-failures',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
      preHandler: [
        authenticate,
        requirePermission('playlist:read'),
        requireStationAccess(),
      ],
    },
    async (req: FastifyRequest<{ Params: StationParams }>, reply: FastifyReply) => {
      const stationId = req.params.id;
      const pool = getPool();

      const res = await pool.query(
        `SELECT id, station_id, playlist_id, status, error_message,
                queued_at, started_at, completed_at, triggered_by
         FROM generation_jobs
         WHERE station_id = $1
           AND status = 'failed'
           AND queued_at >= NOW() - INTERVAL '30 days'
         ORDER BY queued_at DESC`,
        [stationId],
      );

      return reply.code(200).send({ data: res.rows, count: res.rowCount });
    },
  );

  // ── GET /stations/:id/jobs ────────────────────────────────────────────────
  app.get<{ Params: StationParams; Querystring: { limit?: number; offset?: number } }>(
    '/stations/:id/jobs',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
      preHandler: [
        authenticate,
        requirePermission('playlist:read'),
        requireStationAccess(),
      ],
    },
    async (req, reply) => {
      const stationId = req.params.id;
      const limit = req.query.limit ?? 20;
      const offset = req.query.offset ?? 0;

      const pool = getPool();
      const res = await pool.query(
        `SELECT id, station_id, playlist_id, status, error_message,
                queued_at, started_at, completed_at, triggered_by
         FROM generation_jobs
         WHERE station_id = $1
         ORDER BY queued_at DESC
         LIMIT $2 OFFSET $3`,
        [stationId, limit, offset],
      );

      return reply.code(200).send({ data: res.rows, count: res.rowCount });
    },
  );

  // ── GET /jobs/:id ─────────────────────────────────────────────────────────
  app.get<{ Params: JobParams }>(
    '/jobs/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
      preHandler: [
        authenticate,
        requirePermission('playlist:read'),
      ],
    },
    async (req: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const jobId = req.params.id;
      const pool = getPool();

      const res = await pool.query(
        `SELECT gj.id, gj.station_id, gj.playlist_id, gj.status, gj.error_message,
                gj.queued_at, gj.started_at, gj.completed_at, gj.triggered_by
         FROM generation_jobs gj
         WHERE gj.id = $1`,
        [jobId],
      );

      if (res.rows.length === 0) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Job not found' },
        });
      }

      // Enforce station access: non-super/company admins may only see jobs for
      // stations they have access to.
      const job = res.rows[0] as { station_id: string; [key: string]: unknown };
      const { role_code, station_ids } = req.user;
      if (
        role_code !== 'super_admin' &&
        role_code !== 'company_admin' &&
        !station_ids.includes(job.station_id)
      ) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: 'No access to this station' },
        });
      }

      return reply.code(200).send(job);
    },
  );
}
