/**
 * Test helpers for analytics service integration tests.
 *
 * Builds a Fastify app in-process (no HTTP port binding) using Fastify's
 * built-in inject() for HTTP simulation.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import jwt from 'jsonwebtoken';
import { analyticsRoutes } from '../../src/routes/analytics.js';
import { getPool } from '../../src/db.js';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-in-prod';

/**
 * Build a testable Fastify instance.
 * Routes are registered identically to the production app,
 * but the server is never bound to a port.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(sensible);
  await app.register(analyticsRoutes, { prefix: '/api/v1' });

  app.setErrorHandler((err, _req, reply) => {
    if (err.validation) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: err.message, details: err.validation },
      });
    }
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  await app.ready();
  return app;
}

/**
 * Generate a signed JWT for test requests.
 * Uses the same secret the `authenticate` middleware validates against.
 */
export function makeTestToken(overrides: Partial<{
  sub: string;
  company_id: string;
  station_ids: string[];
  role_code: string;
  permissions: string[];
}> = {}): string {
  const payload = {
    sub: overrides.sub ?? 'test-user-id',
    company_id: overrides.company_id ?? 'test-company-id',
    station_ids: overrides.station_ids ?? [],
    role_code: overrides.role_code ?? 'company_admin',
    permissions: overrides.permissions ?? [
      'analytics:read', 'library:read',
    ],
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

/** Close the shared pg Pool after all tests in a file. */
export async function closePool(): Promise<void> {
  await getPool().end();
}
