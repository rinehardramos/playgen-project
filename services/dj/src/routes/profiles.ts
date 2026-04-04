import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import * as profileService from '../services/profileService.js';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // All routes require auth
  app.addHook('preHandler', authenticate);

  app.get('/dj/profiles', async (req, reply) => {
    const { company_id } = (req as any).user;
    return profileService.listProfiles(company_id);
  });

  app.get<{ Params: { id: string } }>('/dj/profiles/:id', async (req, reply) => {
    const { company_id } = (req as any).user;
    const profile = await profileService.getProfile(req.params.id, company_id);
    if (!profile) return reply.notFound('DJ profile not found');
    return profile;
  });

  app.post('/dj/profiles', async (req, reply) => {
    const { company_id } = (req as any).user;
    const profile = await profileService.createProfile(company_id, req.body as any);
    return reply.code(201).send(profile);
  });

  app.patch<{ Params: { id: string } }>('/dj/profiles/:id', async (req, reply) => {
    const { company_id } = (req as any).user;
    const profile = await profileService.updateProfile(req.params.id, company_id, req.body as any);
    if (!profile) return reply.notFound('DJ profile not found');
    return profile;
  });

  app.delete<{ Params: { id: string } }>('/dj/profiles/:id', async (req, reply) => {
    const { company_id } = (req as any).user;
    const deleted = await profileService.deleteProfile(req.params.id, company_id);
    if (!deleted) return reply.badRequest('Cannot delete default profile or profile not found');
    return reply.code(204).send();
  });
}
