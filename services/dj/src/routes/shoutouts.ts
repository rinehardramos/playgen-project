import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import { getPool } from '../db.js';

interface CreateShoutoutBody {
  station_id: string;
  listener_name?: string;
  message: string;
  platform?: string;
}

export async function shoutoutRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // List pending shoutouts for a station
  app.get<{ Querystring: { station_id: string } }>(
    '/dj/shoutouts',
    async (req, reply) => {
      const { station_id } = req.query;
      if (!station_id) return reply.badRequest('station_id query param is required');

      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT ls.id, ls.station_id, ls.listener_name, ls.message, ls.platform,
                ls.status, ls.submitted_by, u.email AS submitted_by_email,
                ls.used_in_script_id, ls.created_at, ls.updated_at
         FROM listener_shoutouts ls
         LEFT JOIN users u ON u.id = ls.submitted_by
         WHERE ls.station_id = $1 AND ls.status = 'pending'
         ORDER BY ls.created_at ASC`,
        [station_id],
      );
      return rows;
    },
  );

  // Submit a new listener shoutout
  app.post<{ Body: CreateShoutoutBody }>(
    '/dj/shoutouts',
    async (req, reply) => {
      const { station_id, listener_name, message, platform } = req.body ?? {};
      if (!station_id || !message?.trim()) {
        return reply.badRequest('station_id and message are required');
      }

      const user = (req as any).user;
      if (!user?.sub) return reply.unauthorized('Authentication required');

      const pool = getPool();
      const { rows } = await pool.query(
        `INSERT INTO listener_shoutouts
           (station_id, submitted_by, listener_name, message, platform)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          station_id,
          user.sub,
          listener_name?.trim() ?? null,
          message.trim(),
          platform ?? 'manual',
        ],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  // Dismiss a shoutout (mark as dismissed without using it)
  app.patch<{ Params: { id: string }; Body: { status: 'dismissed' } }>(
    '/dj/shoutouts/:id',
    async (req, reply) => {
      const { id } = req.params;
      const { status } = req.body ?? {};
      if (status !== 'dismissed') return reply.badRequest('Only status=dismissed is allowed via this endpoint');

      const pool = getPool();
      const { rows, rowCount } = await pool.query(
        `UPDATE listener_shoutouts
         SET status = 'dismissed', updated_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id],
      );
      if (!rowCount) return reply.notFound('Shoutout not found or already processed');
      return rows[0];
    },
  );

  // Delete a shoutout
  app.delete<{ Params: { id: string } }>(
    '/dj/shoutouts/:id',
    async (req, reply) => {
      const { id } = req.params;
      const pool = getPool();
      const { rowCount } = await pool.query(
        `DELETE FROM listener_shoutouts WHERE id = $1`,
        [id],
      );
      if (!rowCount) return reply.notFound('Shoutout not found');
      return reply.code(204).send();
    },
  );
}
