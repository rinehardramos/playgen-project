import { FastifyInstance } from 'fastify';
import { authenticate, requireStationAccess } from '@playgen/middleware';
import { daypartService } from '../services/daypartService';

export async function daypartRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireStationAccess());

  app.get('/stations/:station_id/dj/dayparts', async (req) => {
    const { station_id } = req.params as { station_id: string };
    return daypartService.list(station_id);
  });

  app.post('/stations/:station_id/dj/dayparts', async (req, reply) => {
    const { station_id } = req.params as { station_id: string };
    const daypart = await daypartService.create(station_id, req.body as any);
    return reply.code(201).send(daypart);
  });

  app.put('/stations/:station_id/dj/dayparts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const daypart = await daypartService.update(id, req.body as any);
    if (!daypart) return reply.notFound('Daypart not found');
    return daypart;
  });

  app.delete('/stations/:station_id/dj/dayparts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await daypartService.delete(id);
    return reply.code(204).send();
  });

  app.get('/stations/:station_id/dj/resolve', async (req, reply) => {
    const { station_id } = req.params as { station_id: string };
    const { hour, dayOfWeek } = req.query as { hour: string; dayOfWeek: string };
    
    if (!hour || !dayOfWeek) {
      return reply.badRequest('hour and dayOfWeek queries required');
    }

    const profile = await daypartService.resolveProfileForHour(
      station_id, 
      Number(hour), 
      dayOfWeek.toUpperCase()
    );

    if (!profile) return reply.notFound('No profile resolved');
    return profile;
  });
}
