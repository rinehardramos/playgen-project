/**
 * specRoutes — Station Spec API endpoints.
 *
 * GET  /api/v1/stations/:id/spec         — export spec (JSON or YAML)
 * PUT  /api/v1/stations/:id/spec         — apply spec to existing station
 * POST /api/v1/companies/:id/stations/from-spec — bootstrap new station from spec
 */
import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import { exportSpec, applySpec, bootstrapFromSpec, parseSpec, serializeSpecToYaml } from '../services/specService';

export async function specRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  /**
   * GET /api/v1/stations/:id/spec
   * Export the current station configuration as a StationSpec.
   * Accepts ?format=yaml (default) or ?format=json via query param.
   */
  app.get('/stations/:id/spec', {
    onRequest: [requirePermission('station:read'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { format = 'yaml' } = req.query as { format?: string };

    const spec = await exportSpec(id);
    if (!spec) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Station not found' } });

    if (format === 'json') {
      return reply.code(200).send(spec);
    }

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.code(200).send(serializeSpecToYaml(spec));
  });

  /**
   * PUT /api/v1/stations/:id/spec
   * Apply a StationSpec to an existing station.
   * Body: raw YAML or JSON string, or a JSON object.
   * Returns the updated station row.
   */
  app.put('/stations/:id/spec', {
    onRequest: [requirePermission('station:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    let spec;
    try {
      if (typeof req.body === 'string') {
        spec = parseSpec(req.body);
      } else if (typeof req.body === 'object' && req.body !== null) {
        // Already parsed JSON from Fastify
        spec = req.body;
      } else {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Body must be a YAML or JSON spec' } });
      }
    } catch (err) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: `Invalid spec: ${(err as Error).message}` } });
    }

    const station = await applySpec(id, spec);
    if (!station) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Station not found' } });

    return reply.code(200).send(station);
  });

  /**
   * POST /api/v1/companies/:id/stations/from-spec
   * Create a brand-new station from a StationSpec.
   * Body: raw YAML or JSON string, or a JSON object.
   * Returns the newly created station row.
   */
  app.post('/companies/:id/stations/from-spec', {
    onRequest: [requirePermission('station:create')],
  }, async (req, reply) => {
    const { id: companyId } = req.params as { id: string };

    let spec;
    try {
      if (typeof req.body === 'string') {
        spec = parseSpec(req.body);
      } else if (typeof req.body === 'object' && req.body !== null) {
        spec = req.body;
      } else {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Body must be a YAML or JSON spec' } });
      }
    } catch (err) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: `Invalid spec: ${(err as Error).message}` } });
    }

    const station = await bootstrapFromSpec(companyId, spec);
    return reply.code(201).send(station);
  });
}
