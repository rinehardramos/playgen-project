import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { config } from './config';

const app = Fastify({
  logger: {
    level: config.logLevel,
    ...(config.nodeEnv === 'development' && {
      transport: { target: 'pino-pretty' },
    }),
  },
});

app.register(sensible);

import { profileRoutes } from './routes/profiles';
import { daypartRoutes } from './routes/dayparts';
import { llmRoutes } from './routes/llm';
import { scriptTemplateRoutes } from './routes/scriptTemplates';
import { scriptRoutes } from './routes/scripts';
import { startWorker } from './queue/worker';

app.register(profileRoutes, { prefix: '/api/v1' });
app.register(daypartRoutes, { prefix: '/api/v1' });
app.register(llmRoutes, { prefix: '/api/v1' });
app.register(scriptTemplateRoutes, { prefix: '/api/v1' });
app.register(scriptRoutes, { prefix: '/api/v1' });

// Start BullMQ worker
startWorker();

app.get('/health', async () => ({ 
  status: 'ok', 
  service: 'dj-service',
  timestamp: new Date().toISOString()
}));

// Placeholder for routes
app.get('/api/v1/dj/status', async () => ({ status: 'active' }));

app.setErrorHandler((err, req, reply) => {
  app.log.error(err);
  if (err.validation) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.message, details: err.validation },
    });
  }
  return reply.code(err.statusCode || 500).send({ 
    error: { 
      code: err.code || 'INTERNAL_ERROR', 
      message: err.message || 'Internal server error' 
    } 
  });
});

const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`DJ Service listening on port ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

import { djQueue, connection } from './queue/djQueue';

// Graceful shutdown
const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down...`);
    await app.close();
    await djQueue.close();
    await connection.quit();
    process.exit(0);
  });
});

start();

export default app;
