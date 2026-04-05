import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  login,
  logout,
  refresh,
  forgotPassword,
  resetPassword,
  acceptInvite,
  AuthError,
} from '../services/authService';
import { loginWithGoogle, type GoogleProfile } from '../services/oauthService';
import { authenticate } from '@playgen/middleware';
import { getPool } from '../db';

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

  // ── GET /me — current user profile ────────────────────────────────────────
  app.get('/me', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.display_name, r.label AS role_label
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.is_active = true`,
      [req.user.sub],
    );
    if (!rows[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return reply.code(200).send(rows[0]);
  });

  // ── PUT /me — update display_name and/or password ─────────────────────────
  app.put<{ Body: { display_name?: string; password?: string } }>(
    '/me',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            display_name: { type: 'string', minLength: 1, maxLength: 255 },
            password: { type: 'string', minLength: 8 },
          },
        },
      },
      preHandler: [authenticate],
    },
    async (req, reply) => {
      const { display_name, password } = req.body;
      const pool = getPool();
      const userId = req.user.sub;

      if (display_name !== undefined) {
        await pool.query(
          `UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2`,
          [display_name, userId],
        );
      }

      if (password) {
        const bcrypt = await import('bcryptjs');
        const hash = await bcrypt.hash(password, 12);
        await pool.query(
          `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
          [hash, userId],
        );
      }

      return reply.code(200).send({ message: 'Profile updated' });
    },
  );

  // ── GET /auth/google/callback — Google OAuth2 callback ────────────────────
  // The redirect to /api/v1/auth/google is created automatically by @fastify/oauth2
  // (startRedirectPath). This route handles the code exchange and issues JWT tokens.
  app.get('/auth/google/callback', async (req, reply) => {
    // Only reachable if GOOGLE_CLIENT_ID is configured (plugin registered in index.ts)
    if (!(app as unknown as Record<string, unknown>)['googleOAuth2']) {
      return reply.code(501).send({ error: { code: 'OAUTH_NOT_CONFIGURED', message: 'Google OAuth is not configured.' } });
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    try {
      // Exchange auth code for Google access token
      const { token } = await (app as unknown as {
        googleOAuth2: { getAccessTokenFromAuthorizationCodeFlow: (req: FastifyRequest) => Promise<{ token: { access_token: string } }> };
      }).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);

      // Fetch user profile from Google
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch Google user info');
      const profile = (await res.json()) as GoogleProfile;

      const { tokens } = await loginWithGoogle(profile);

      const params = new URLSearchParams({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      return reply.redirect(`${frontendUrl}/auth/callback?${params.toString()}`, 302);
    } catch (err) {
      if (err instanceof AuthError && err.code === 'OAUTH_NO_ACCOUNT') {
        return reply.redirect(`${frontendUrl}/login?error=no_account`, 302);
      }
      app.log.error(err, 'Google OAuth callback error');
      return reply.redirect(`${frontendUrl}/login?error=oauth_failed`, 302);
    }
  });
}
