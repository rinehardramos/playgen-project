import type { FastifyInstance } from 'fastify';
import { login, logout, refresh, AuthError } from '../services/authService';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    try {
      const result = await login(email, password);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(401).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  app.post('/auth/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refresh_token'],
        properties: {
          refresh_token: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { refresh_token } = req.body as { refresh_token: string };
    try {
      const tokens = await refresh(refresh_token);
      return reply.code(200).send(tokens);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(401).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  app.post('/auth/logout', {
    schema: {
      body: {
        type: 'object',
        required: ['refresh_token'],
        properties: {
          refresh_token: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { refresh_token } = req.body as { refresh_token: string };
    await logout(refresh_token);
    return reply.code(204).send();
  });
}
