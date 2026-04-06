import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import sensible from '@fastify/sensible';
import fastifyCookie from '@fastify/cookie';
import oauthPlugin from '@fastify/oauth2';
import rateLimit from '@fastify/rate-limit';
import { registerSecurity } from '@playgen/middleware';
import { authRoutes } from './routes/auth';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty' },
    }),
  },
  // Hard 100 KB body cap — auth payloads are tiny; anything larger is suspicious.
  bodyLimit: 100 * 1024,
});

registerSecurity(app);

// Global rate limit across the auth surface. Per-route overrides in routes/auth.ts
// tighten /auth/login + /auth/forgot-password + /auth/reset-password further.
app.register(rateLimit, {
  max: 60,
  timeWindow: '1 minute',
  keyGenerator: (req) => (req.headers['x-forwarded-for'] as string) ?? req.ip,
});

app.register(sensible);
app.register(fastifyCookie);

// Register Google OAuth2 plugin only when credentials are configured.
// In production set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL.
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
    // Do NOT leak `details[]` (schema field names + values) on the auth surface.
    // The full validation error is logged server-side; the client gets a generic 400.
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request payload' },
    });
  }
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
});

const port = Number(process.env.PORT ?? 3001);
const host = '0.0.0.0';

app.listen({ port, host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

export default app;
