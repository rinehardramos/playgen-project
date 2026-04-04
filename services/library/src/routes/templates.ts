import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import * as templateService from '../services/templateService';

export async function templateRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  // ── Templates ──────────────────────────────────────────────────────────────

  app.get('/stations/:id/templates', {
    onRequest: [requirePermission('library:read'), requireStationAccess()],
  }, async (req) => {
    const { id } = req.params as { id: string };
    return templateService.listTemplates(id);
  });

  app.post('/stations/:id/templates', {
    onRequest: [requirePermission('library:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name: string;
      type: '1_day' | '3_hour' | '4_hour';
      is_default?: boolean;
    };
    const template = await templateService.createTemplate({ ...body, station_id: id });
    return reply.code(201).send(template);
  });

  app.get('/templates/:id', {
    onRequest: [requirePermission('library:read')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = await templateService.getTemplate(id);
    if (!template) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
    return template;
  });

  app.put('/templates/:id', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = await templateService.updateTemplate(
      id,
      req.body as Parameters<typeof templateService.updateTemplate>[1]
    );
    if (!template) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
    return template;
  });

  app.delete('/templates/:id', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await templateService.deleteTemplate(id);
    if (!deleted) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
    return reply.code(204).send();
  });

  app.post('/templates/:id/clone', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { target_station_id } = req.body as { target_station_id: string };
    
    if (!target_station_id) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'target_station_id is required' } });
    }

    const template = await templateService.cloneTemplate(id, target_station_id);
    return reply.code(201).send(template);
  });

  // ── Template Slots (bulk replace) ──────────────────────────────────────────

  app.put('/templates/:id/slots', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { slots } = req.body as {
      slots: Array<{ hour: number; position: number; required_category_id: string }>;
    };
    const result = await templateService.setTemplateSlots(id, slots);
    return reply.code(200).send(result);
  });

  // ── Individual slot upsert / delete ────────────────────────────────────────

  app.put('/templates/:id/slots/:hour/:position', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id, hour, position } = req.params as { id: string; hour: string; position: string };
    const { required_category_id } = req.body as { required_category_id: string };
    const slot = await templateService.upsertTemplateSlot(id, {
      hour: parseInt(hour, 10),
      position: parseInt(position, 10),
      required_category_id,
    });
    return reply.code(200).send(slot);
  });

  app.delete('/templates/:id/slots/:hour/:position', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id, hour, position } = req.params as { id: string; hour: string; position: string };
    const deleted = await templateService.deleteTemplateSlot(
      id,
      parseInt(hour, 10),
      parseInt(position, 10)
    );
    if (!deleted) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Slot not found' } });
    return reply.code(204).send();
  });
}
