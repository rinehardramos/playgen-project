import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@playgen/middleware';
import * as userService from '../services/userService';

export async function userRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  app.get('/me', async (req) => {
    const user = await userService.getUser(req.user.sub);
    if (!user) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return user;
  });

  app.put('/me', async (req, reply) => {
    const body = req.body as { display_name?: string; password?: string };
    if (body.password && body.password.length < 8) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' } });
    }
    const user = await userService.updateUserProfile(req.user.sub, body);
    if (!user) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return user;
  });

  app.get('/companies/:id/users', { onRequest: [requirePermission('users:read')] }, async (req) => {
    const { id } = req.params as { id: string };
    return userService.listUsers(id);
  });

  app.post('/companies/:id/users', { onRequest: [requirePermission('users:write')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      role_id: string;
      email: string;
      display_name: string;
      password: string;
      station_ids?: string[];
    };
    const user = await userService.createUser({ ...body, company_id: id });
    return reply.code(201).send(user);
  });

  app.get('/users/:id', { onRequest: [requirePermission('users:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await userService.getUser(id);
    if (!user) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return user;
  });

  app.put('/users/:id', { onRequest: [requirePermission('users:write')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await userService.updateUser(id, req.body as Parameters<typeof userService.updateUser>[1]);
    if (!user) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return user;
  });

  app.delete('/users/:id', { onRequest: [requirePermission('users:write')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await userService.deactivateUser(id);
    if (!ok) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return reply.code(204).send();
  });

  app.post('/users/:id/reset-password', { onRequest: [requirePermission('users:write')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { password } = req.body as { password: string };
    if (!password || password.length < 8) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' } });
    }
    const ok = await userService.resetUserPassword(id, password);
    if (!ok) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return reply.code(204).send();
  });

  app.get('/companies/:id/roles', { onRequest: [requirePermission('users:read')] }, async (req) => {
    const { id } = req.params as { id: string };
    return userService.listRoles(id);
  });
}
