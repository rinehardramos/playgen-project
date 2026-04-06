import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@playgen/middleware';
import { getPool } from '../db';
import { listLogs, purgeOldLogs } from '../services/systemLogService';
import type { SystemLogLevel, SystemLogCategory } from '@playgen/types';

export async function systemLogRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  /**
   * GET /api/v1/companies/:id/logs
   * Query params: level, category, station_id, from, to, page, limit
   * Returns paginated list of system log entries, newest first.
   */
  app.get('/companies/:id/logs', {
    onRequest: [requirePermission('company:read')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as {
      level?: string;
      category?: string;
      station_id?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    };

    // Validate level
    const validLevels: SystemLogLevel[] = ['info', 'warn', 'error'];
    if (q.level && !validLevels.includes(q.level as SystemLogLevel)) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: `level must be one of: ${validLevels.join(', ')}` },
      });
    }

    // Validate category
    const validCategories: SystemLogCategory[] = ['dj', 'tts', 'review', 'config', 'playlist', 'auth', 'system'];
    if (q.category && !validCategories.includes(q.category as SystemLogCategory)) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: `category must be one of: ${validCategories.join(', ')}` },
      });
    }

    const result = await listLogs(getPool(), {
      company_id: id,
      level: q.level as SystemLogLevel | undefined,
      category: q.category as SystemLogCategory | undefined,
      station_id: q.station_id,
      from: q.from,
      to: q.to,
      page: q.page ? parseInt(q.page, 10) : undefined,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    });

    return result;
  });

  /**
   * POST /api/v1/companies/:id/logs/purge
   * Manually trigger 90-day log retention purge for this company only.
   */
  app.post('/companies/:id/logs/purge', {
    onRequest: [requirePermission('company:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await purgeOldLogs(getPool(), id);
    return reply.code(200).send({ deleted });
  });
}
