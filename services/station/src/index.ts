import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { registerSecurity } from '@playgen/middleware';
import { companyRoutes } from './routes/companies';
import { stationRoutes } from './routes/stations';
import { stationSettingsRoutes } from './routes/stationSettings';
import { userRoutes } from './routes/users';
import { roleRoutes } from './routes/roles';
import { subscriptionRoutes } from './routes/subscriptions';
import { programRoutes } from './routes/programs';
import { systemLogRoutes } from './routes/systemLogs';
import { ingestRoutes } from './routes/ingest';
import { publishRoutes } from './routes/publish';
import { publicStationRoutes } from './routes/publicStations';
import { startPublishWorker } from './queues/publishPipeline';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty' },
    }),
  },
});

registerSecurity(app);
app.register(sensible);
app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

app.get('/health', async () => ({ status: 'ok', service: 'station-service' }));

app.register(companyRoutes,        { prefix: '/api/v1' });
app.register(stationRoutes,        { prefix: '/api/v1' });
app.register(stationSettingsRoutes, { prefix: '/api/v1' });
app.register(userRoutes,           { prefix: '/api/v1' });
app.register(roleRoutes,           { prefix: '/api/v1' });
app.register(subscriptionRoutes,   { prefix: '/api/v1' });
app.register(programRoutes,        { prefix: '/api/v1' });
app.register(systemLogRoutes,      { prefix: '/api/v1' });
app.register(ingestRoutes,         { prefix: '/api/v1' });
app.register(publishRoutes,        { prefix: '/api/v1' });
app.register(publicStationRoutes,  { prefix: '/api/v1' });

app.setErrorHandler((err: FastifyError, _req, reply) => {
  app.log.error(err);
  if (err.validation) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.message, details: err.validation },
    });
  }
  if ((err as NodeJS.ErrnoException).code === '23505') {
    return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Resource already exists' } });
  }
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
});

const port = Number(process.env.PORT ?? 3002);
app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
});

// Start publish pipeline worker (connects to Redis)
if (process.env.REDIS_URL) {
  startPublishWorker();
}

export default app;
