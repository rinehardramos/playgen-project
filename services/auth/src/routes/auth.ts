import type { FastifyInstance } from 'fastify';
import {
  login,
  logout,
  refresh,
  forgotPassword,
  resetPassword,
  acceptInvite,
  AuthError,
} from '../services/authService';

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

  // Password Reset

  app.post('/auth/forgot-password', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
    },
  }, async (req, reply) => {
    const { email } = req.body as { email: string };
    await forgotPassword(email);
    return reply.code(200).send({ message: 'If that email is registered, a reset link has been sent.' });
  });

  app.post('/auth/reset-password', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const { token, password } = req.body as { token: string; password: string };
    try {
      await resetPassword(token, password);
      return reply.code(200).send({ message: 'Password reset successfully.' });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(400).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  // Invite Acceptance

  app.post('/auth/accept-invite', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'display_name', 'password'],
        properties: {
          token: { type: 'string', minLength: 1 },
          display_name: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const { token, display_name, password } = req.body as {
      token: string;
      display_name: string;
      password: string;
    };
    try {
      const result = await acceptInvite(token, display_name, password);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        const statusCode = err.code === 'EMAIL_TAKEN' ? 409 : 400;
        return reply.code(statusCode).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });
}
