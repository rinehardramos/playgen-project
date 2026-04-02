import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@playgen/middleware';
import * as companyService from '../services/companyService';
import { ensureCompanyRoles } from '../services/userService';

export async function companyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  app.get('/companies', { onRequest: [requirePermission('company:read')] }, async () => {
    return companyService.listCompanies();
  });

  app.post('/companies', { onRequest: [requirePermission('company:write')] }, async (req, reply) => {
    const body = req.body as { name: string; slug: string };
    const company = await companyService.createCompany(body);
    await ensureCompanyRoles(company.id);
    return reply.code(201).send(company);
  });

  app.get('/companies/:id', { onRequest: [requirePermission('company:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const company = await companyService.getCompany(id);
    if (!company) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Company not found' } });
    return company;
  });

  app.put('/companies/:id', { onRequest: [requirePermission('company:write')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const company = await companyService.updateCompany(id, req.body as { name?: string; slug?: string });
    if (!company) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Company not found' } });
    return company;
  });

  app.delete('/companies/:id', { onRequest: [requirePermission('company:write')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await companyService.deleteCompany(id);
    if (!deleted) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Company not found' } });
    return reply.code(204).send();
  });
}
