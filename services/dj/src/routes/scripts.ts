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

  // Review Endpoints
  app.post('/dj/scripts/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { sub: userId } = (req as any).user;

    await scriptService.updateScriptReview(id, { status: 'approved', userId });
    await scriptService.updateScriptStatus(id, 'generating_audio');
    
    // Phase 2: Trigger BullMQ audio generation here
    // For Phase 1, we just mark it as completed for simulation
    await scriptService.updateScriptStatus(id, 'completed');

    return { message: 'Script approved' };
  });

  app.post('/dj/scripts/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { sub: userId } = (req as any).user;
    const { reason } = req.body as { reason?: string };

    await scriptService.updateScriptReview(id, { status: 'rejected', notes: reason, userId });
    
    // Re-queue generation
    const script = await scriptService.getScript(id);
    if (script) {
      await djQueue.add('generate-script', { 
        scriptId: id, 
        stationId: script.station_id, 
        playlistId: script.playlist_id 
      });
    }

    return { message: 'Script rejected and re-queued' };
  });

  app.put('/dj/segments/:id/text', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text } = req.body as { text: string };
    if (!text) return reply.badRequest('text is required');

    await scriptService.updateSegmentText(id, text);
    return { message: 'Segment text updated' };
  });

  app.post('/dj/segments/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    await scriptService.updateSegmentReview(id, 'approved');
    return { message: 'Segment approved' };
  });

  app.post('/dj/segments/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { scriptGenerator } = await import('../services/scriptGenerator');
    
    const newText = await scriptGenerator.regenerateSegment(id);
    await scriptService.updateSegmentReview(id, 'rejected'); // Re-marked as rejected then edited technically
    
    return { message: 'Segment regenerated', text: newText };
  });
}
