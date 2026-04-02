import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import * as categoryService from '../services/categoryService';

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  app.get('/stations/:id/categories', {
    onRequest: [requirePermission('library:read'), requireStationAccess()],
  }, async (req) => {
    const { id } = req.params as { id: string };
    return categoryService.listCategories(id);
  });

  app.post('/stations/:id/categories', {
    onRequest: [requirePermission('library:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { code: string; label: string; rotation_weight?: number; color_tag?: string };
    const category = await categoryService.createCategory({ ...body, station_id: id });
    return reply.code(201).send(category);
  });

  app.put('/categories/:id', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const category = await categoryService.updateCategory(id, req.body as Parameters<typeof categoryService.updateCategory>[1]);
    if (!category) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
    return category;
  });

  app.delete('/categories/:id', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await categoryService.deleteCategory(id);
    if (result.hasSongs) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Category has active songs. Deactivate songs first.' } });
    }
    if (!result.deleted) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
    return reply.code(204).send();
  });
}
