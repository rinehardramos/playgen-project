import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { profileRoutes } from './routes/profiles.js';
import { daypartRoutes } from './routes/dayparts.js';
import { scriptTemplateRoutes } from './routes/scriptTemplates.js';
import { scriptRoutes } from './routes/scripts.js';
import { shoutoutRoutes } from './routes/shoutouts.js';
import { socialAuthRoutes } from './routes/socialAuth.js';
import { closeQueue } from './queues/djQueue.js';
import { scheduleAudioCleanup, closeCleanupQueue } from './queues/audioCleanupQueue.js';

const app = Fastify({
  logger: {
    level: config.logLevel,
    ...(config.nodeEnv === 'development' && {
      transport: { target: 'pino-pretty' },
    }),
  },
});

app.register(sensible);
app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

// ── Static file serving for TTS audio ────────────────────────────────────────

app.register(fastifyStatic, {
  root: config.storage.localPath,
  prefix: '/api/v1/dj/audio/',
  decorateReply: false,
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', service: 'dj-service' }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.register(profileRoutes,        { prefix: '/api/v1' });
app.register(daypartRoutes,        { prefix: '/api/v1' });
app.register(scriptTemplateRoutes, { prefix: '/api/v1' });
app.register(scriptRoutes,         { prefix: '/api/v1' });
app.register(shoutoutRoutes,       { prefix: '/api/v1' });
app.register(socialAuthRoutes,     { prefix: '/api/v1' });

// ── Error handler ─────────────────────────────────────────────────────────────

app.setErrorHandler((err: FastifyError, req, reply) => {
  app.log.error({ err, url: req.url }, 'unhandled error');
  if (err.validation) {
    return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: err.message, details: err.validation } });
  }
  if ((err as NodeJS.ErrnoException).code === '23505') {
    return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Resource already exists' } });
  }
  const statusCode = err.statusCode ?? 500;
  const isExposed = statusCode < 500;
  return reply.code(statusCode).send({
    error: { code: err.code ?? 'INTERNAL_ERROR', message: isExposed ? err.message : 'Internal server error' },
  });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down gracefully`);
  try {
    await closeQueue();
    await closeCleanupQueue();
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(1)); });

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`dj-service listening on port ${config.port}`);
  scheduleAudioCleanup().catch((schedErr) => {
    app.log.error(schedErr, 'Failed to schedule audio cleanup job');
  });
});

export default app;
