import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import * as templateService from '../services/scriptTemplateService.js';

export async function scriptTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get<{ Params: { stationId: string } }>(
    '/dj/stations/:stationId/script-templates',
    async (req) => templateService.listTemplates(req.params.stationId),
  );

  app.post<{ Params: { stationId: string } }>(
    '/dj/stations/:stationId/script-templates',
    async (req, reply) => {
      const template = await templateService.createTemplate(req.params.stationId, req.body as any);
      return reply.code(201).send(template);
    },
  );

  app.patch<{ Params: { stationId: string; id: string } }>(
    '/dj/stations/:stationId/script-templates/:id',
    async (req, reply) => {
      const template = await templateService.updateTemplate(
        req.params.id, req.params.stationId, req.body as any,
      );
      if (!template) return reply.notFound('Script template not found');
      return template;
    },
  );
}
