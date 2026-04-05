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
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // Core fields
          name: { type: 'string', minLength: 1, maxLength: 255 },
          timezone: { type: 'string', maxLength: 100 },
          broadcast_start_hour: { type: 'integer', minimum: 0, maximum: 23 },
          broadcast_end_hour: { type: 'integer', minimum: 0, maximum: 23 },
          active_days: { type: 'array', items: { type: 'string' } },
          is_active: { type: 'boolean' },
          dj_enabled: { type: 'boolean' },
          dj_auto_approve: { type: 'boolean' },
          openai_api_key: { type: 'string' },
          elevenlabs_api_key: { type: 'string' },
          openrouter_api_key: { type: 'string' },
          // Identity (migration 039)
          callsign: { type: ['string', 'null'], maxLength: 10 },
          tagline: { type: ['string', 'null'], maxLength: 255 },
          frequency: { type: ['string', 'null'], maxLength: 20 },
          broadcast_type: { type: ['string', 'null'], enum: ['fm', 'am', 'online', 'podcast', 'dab', null] },
          // Locale
          city: { type: ['string', 'null'], maxLength: 100 },
          province: { type: ['string', 'null'], maxLength: 100 },
          country: { type: ['string', 'null'], maxLength: 100 },
          locale_code: { type: ['string', 'null'], maxLength: 20 },
          latitude: { type: ['number', 'null'], minimum: -90, maximum: 90 },
          longitude: { type: ['number', 'null'], minimum: -180, maximum: 180 },
          // Social media
          facebook_page_id: { type: ['string', 'null'], maxLength: 100 },
          facebook_page_url: { type: ['string', 'null'], maxLength: 255 },
          twitter_handle: { type: ['string', 'null'], maxLength: 100 },
          instagram_handle: { type: ['string', 'null'], maxLength: 100 },
          youtube_channel_url: { type: ['string', 'null'], maxLength: 255 },
          // Branding
          logo_url: { type: ['string', 'null'], maxLength: 500 },
          primary_color: { type: ['string', 'null'], pattern: '^#[0-9A-Fa-f]{6}$' },
          secondary_color: { type: ['string', 'null'], pattern: '^#[0-9A-Fa-f]{6}$' },
          website_url: { type: ['string', 'null'], maxLength: 255 },
        },
      },
    },
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
