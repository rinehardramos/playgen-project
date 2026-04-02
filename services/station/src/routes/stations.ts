import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import * as stationService from '../services/stationService';

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
    return station;
  });

  app.put('/stations/:id', {
    onRequest: [requirePermission('station:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const station = await stationService.updateStation(id, req.body as Parameters<typeof stationService.updateStation>[1]);
    if (!station) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Station not found' } });
    return station;
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
