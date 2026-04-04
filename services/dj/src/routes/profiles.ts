import { FastifyInstance } from 'fastify';
import { authenticate, requireStationAccess } from '@playgen/middleware';
import { profileService } from '../services/profileService';

export async function profileRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireStationAccess());

  app.get('/stations/:station_id/dj/profiles', async (req) => {
    const { station_id } = req.params as { station_id: string };
    return profileService.list(station_id);
  });

  app.get('/stations/:station_id/dj/profiles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const profile = await profileService.get(id);
    if (!profile) return reply.notFound('Profile not found');
    return profile;
  });

  app.post('/stations/:station_id/dj/profiles', async (req, reply) => {
    const { station_id } = req.params as { station_id: string };
    const profile = await profileService.create(station_id, req.body as any);
    return reply.code(201).send(profile);
  });

  app.put('/stations/:station_id/dj/profiles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const profile = await profileService.update(id, req.body as any);
    if (!profile) return reply.notFound('Profile not found');
    return profile;
  });

  app.delete('/stations/:station_id/dj/profiles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await profileService.deactivate(id);
    return reply.code(204).send();
  });
}
