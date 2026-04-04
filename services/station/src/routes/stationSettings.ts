import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import * as settingsService from '../services/stationSettingsService';

export async function stationSettingsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  /** GET /api/v1/stations/:id/settings — list all settings (secrets masked) */
  app.get('/stations/:id/settings', {
    onRequest: [requirePermission('station:read'), requireStationAccess()],
  }, async (req) => {
    const { id } = req.params as { id: string };
    return settingsService.listSettings(id);
  });

  /** PUT /api/v1/stations/:id/settings/:key — upsert a setting */
  app.put('/stations/:id/settings/:key', {
    onRequest: [requirePermission('station:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id, key } = req.params as { id: string; key: string };
    const body = req.body as { value: string; is_secret?: boolean };

    if (typeof body?.value !== 'string') {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: '`value` (string) is required' },
      });
    }

    const setting = await settingsService.upsertSetting(
      id,
      key,
      body.value,
      body.is_secret ?? false,
    );
    return reply.code(200).send(setting);
  });

  /** DELETE /api/v1/stations/:id/settings/:key — remove a setting */
  app.delete('/stations/:id/settings/:key', {
    onRequest: [requirePermission('station:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id, key } = req.params as { id: string; key: string };
    const deleted = await settingsService.deleteSetting(id, key);
    if (!deleted) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Setting not found' },
      });
    }
    return reply.code(204).send();
  });
}
