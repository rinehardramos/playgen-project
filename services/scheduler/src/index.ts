import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { schedulerRoutes } from './routes/scheduler';
import { configRoutes } from './routes/config';
import { startCron, stopCron } from './services/cronService';
import { closeQueue } from './services/queueService';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty' },
    }),
  },
});

app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
app.register(sensible);

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', service: 'scheduler-service' }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.register(schedulerRoutes, { prefix: '/api/v1' });
app.register(configRoutes, { prefix: '/api/v1' });

// ── Error handler ─────────────────────────────────────────────────────────────

app.setErrorHandler((err: FastifyError, req, reply) => {
  app.log.error(err);
  if (err.validation) {
    return reply.code(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: err.validation,
      },
    });
  }
  return reply
    .code(500)
    .send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down gracefully`);
  try {
    stopCron();
    await closeQueue();
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
process.on('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)); });

// ── Start server ──────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3004);
const host = '0.0.0.0';

app.listen({ port, host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  startCron();
  app.log.info(`scheduler-service listening on port ${port}`);
});

export default app;
