import { FastifyInstance } from 'fastify';
import { authenticate, requireStationAccess } from '@playgen/middleware';
import { scriptService } from '../services/scriptService';
import { djQueue } from '../queue/djQueue';
import { getPool } from '../db';

export async function scriptRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/playlists/:playlist_id/dj/generate', async (req, reply) => {
    const { playlist_id } = req.params as { playlist_id: string };
    
    // Fetch station_id from playlist
    const { rows: playlists } = await getPool().query(
      'SELECT station_id FROM playlists WHERE id = $1',
      [playlist_id]
    );

    if (playlists.length === 0) return reply.notFound('Playlist not found');
    const stationId = playlists[0].station_id;

    // Check station access (manual check because :id is not station_id here)
    const { role_code, station_ids } = (req as any).user;
    if (role_code !== 'super_admin' && role_code !== 'company_admin' && !station_ids.includes(stationId)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'No access to this station' } });
    }

    const script = await scriptService.createScript(stationId, playlist_id);
    
    await djQueue.add('generate-script', {
      scriptId: script.id,
      stationId,
      playlistId: playlist_id
    });

    return reply.code(202).send(script);
  });

  app.get('/dj/scripts/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string };
    const script = await scriptService.getScript(id);
    if (!script) return reply.notFound('Script not found');
    return { status: script.status, error_message: script.error_message };
  });

  app.get('/dj/scripts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const script = await scriptService.getScriptWithSegments(id);
    if (!script) return reply.notFound('Script not found');
    return script;
  });
}
