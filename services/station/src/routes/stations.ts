import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import * as stationService from '../services/stationService';

const SECRET_KEYS = ['openai_api_key', 'elevenlabs_api_key', 'openrouter_api_key'] as const;

function maskSecrets<T extends Record<string, unknown>>(row: T): T {
  const masked = { ...row };
  for (const key of SECRET_KEYS) {
    if (key in masked) {
      (masked as Record<string, unknown>)[key] = masked[key] ? '***' : null;
    }
  }
  return masked;
}

export async function stationRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  app.get('/companies/:id/stations', { onRequest: [requirePermission('station:read')] }, async (req) => {
    const { id } = req.params as { id: string };
    return stationService.listStations(id);
  });

  app.post('/companies/:id/stations', { onRequest: [requirePermission('station:write')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name: string;
      timezone?: string;
      broadcast_start_hour?: number;
      broadcast_end_hour?: number;
      active_days?: string[];
    };
    const station = await stationService.createStation({ ...body, company_id: id });
    return reply.code(201).send(station);
  });

  app.get('/stations/:id', {
    onRequest: [requirePermission('station:read'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const station = await stationService.getStation(id);
    if (!station) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Station not found' } });
    return maskSecrets(station as unknown as Record<string, unknown>);
  });

  app.put('/stations/:id', {
    onRequest: [requirePermission('station:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const station = await stationService.updateStation(id, req.body as Parameters<typeof stationService.updateStation>[1]);
    if (!station) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Station not found' } });
    return maskSecrets(station as unknown as Record<string, unknown>);
  });

  app.delete('/stations/:id', {
    onRequest: [requirePermission('station:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await stationService.deleteStation(id);
    if (!deleted) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Station not found' } });
    return reply.code(204).send();
  });
}
