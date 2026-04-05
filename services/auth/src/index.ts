import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import sensible from '@fastify/sensible';
import fastifyCookie from '@fastify/cookie';
import oauthPlugin from '@fastify/oauth2';
import { authRoutes } from './routes/auth';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty' },
    }),
  },
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

app.setErrorHandler((err: FastifyError, req, reply) => {
  app.log.error(err);
  if (err.validation) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.message, details: err.validation },
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
