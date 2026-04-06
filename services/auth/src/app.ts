import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import sensible from '@fastify/sensible';
import fastifyCookie from '@fastify/cookie';
import oauthPlugin from '@fastify/oauth2';
import rateLimit from '@fastify/rate-limit';
import { registerSecurity } from '@playgen/middleware';
import { authRoutes } from './routes/auth';

/**
 * buildApp — Fastify factory used by both production boot (index.ts) and the
 * security test suite. Returns an unstarted, fully-registered instance.
 *
 * Tests use `app.inject({...})` against the returned instance, so listen() is
 * never called and no port is bound.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(process.env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty' },
      }),
    },
    bodyLimit: 100 * 1024,
    // Honor X-Forwarded-For from the gateway so req.ip reflects the real client.
    // This is what makes per-IP rate limiting work behind nginx.
    trustProxy: true,
  });

  registerSecurity(app);

  app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.headers['x-forwarded-for'] as string) ?? req.ip,
  });

  app.register(sensible);
  app.register(fastifyCookie);

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    app.register(oauthPlugin, {
      name: 'googleOAuth2',
      credentials: {
        client: {
          id: process.env.GOOGLE_CLIENT_ID,
          secret: process.env.GOOGLE_CLIENT_SECRET,
        },
        auth: oauthPlugin.GOOGLE_CONFIGURATION,
      },
      scope: ['profile', 'email'],
      callbackUri: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost/api/v1/auth/google/callback',
      startRedirectPath: '/api/v1/auth/google',
      cookie: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax' },
    });
  }

  app.get('/health', async () => ({ status: 'ok', service: 'auth-service' }));

  app.register(authRoutes, { prefix: '/api/v1' });

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    app.log.error(err);
    if (err.validation) {
      // Do NOT leak `details[]` on the auth surface.
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request payload' },
      });
    }
    // Pass through Fastify-tagged 4xx errors (body limit, rate limit, etc.)
    // so they don't get masked as 500.
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: { code: err.code ?? 'CLIENT_ERROR', message: err.message },
      });
    }
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return app;
}
