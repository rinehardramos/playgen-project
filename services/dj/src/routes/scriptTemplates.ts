import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@playgen/middleware';
import * as templateService from '../services/scriptTemplateService.js';

export async function scriptTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { stationId: string } }>(
    '/dj/stations/:stationId/script-templates',
    async (req) => templateService.listTemplates(req.params.stationId),
  );

  app.post<{ Params: { stationId: string }; Body: any }>(
    '/dj/stations/:stationId/script-templates',
    async (req, reply) => {
      const template = await templateService.createTemplate(req.params.stationId, req.body);
      return reply.code(201).send(template);
    },
  );

  app.patch<{ Params: { stationId: string; id: string }; Body: any }>(
    '/dj/stations/:stationId/script-templates/:id',
    async (req, reply) => {
      const template = await templateService.updateTemplate(
        req.params.id, req.params.stationId, req.body,
      );
      if (!template) return reply.notFound('Script template not found');
      return template;
    },
  );
}
