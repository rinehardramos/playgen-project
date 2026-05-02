import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@playgen/middleware';
import { exportEpisode } from '../services/programExportService';

export async function programExportRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  /**
   * GET /programs/:id/episodes/:episodeId/export
   * Returns the episode as a .playgen ZIP download.
   * Permission: program:read
   */
  app.get('/programs/:id/episodes/:episodeId/export', {
    onRequest: [requirePermission('program:read')],
  }, async (req, reply) => {
    const { episodeId } = req.params as { id: string; episodeId: string };

    let buffer: Buffer;
    try {
      buffer = await exportEpisode(episodeId);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & { code?: string };
      if (e.code === 'NOT_FOUND') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found' } });
      }
      throw err;
    }

    return reply
      .code(200)
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="episode-${episodeId}.playgen"`)
      .send(buffer);
  });
}
