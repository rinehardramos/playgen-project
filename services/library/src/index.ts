import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import { categoryRoutes } from './routes/categories';
import { songRoutes } from './routes/songs';
import { templateRoutes } from './routes/templates';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty' },
    }),
  },
});

app.register(sensible);
app.register(multipart, {
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.get('/health', async () => ({ status: 'ok', service: 'library-service' }));

app.register(categoryRoutes, { prefix: '/api/v1' });
app.register(songRoutes, { prefix: '/api/v1' });
app.register(templateRoutes, { prefix: '/api/v1' });

app.setErrorHandler((err, _req, reply) => {
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

const port = Number(process.env.PORT ?? 3003);
app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
});

export default app;
