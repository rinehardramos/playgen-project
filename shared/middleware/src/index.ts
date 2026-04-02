import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '@playgen/types';

const ACCESS_SECRET = () =>
  process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-in-prod';

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
  }
  try {
    req.user = jwt.verify(authHeader.slice(7), ACCESS_SECRET()) as JwtPayload;
  } catch {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}

export function requirePermission(permission: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user?.permissions?.includes(permission)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
  };
}

export function requireStationAccess() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as Record<string, string>;
    const stationId = params.id ?? params.station_id;
    if (!stationId) return;
    const { role_code, station_ids } = req.user;
    if (role_code === 'super_admin' || role_code === 'company_admin') return;
    if (!station_ids.includes(stationId)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'No access to this station' } });
    }
  };
}

export function requireCompanyMatch() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as Record<string, string>;
    const companyId = params.company_id ?? params.id;
    if (!companyId) return;
    const { role_code, company_id } = req.user;
    if (role_code === 'super_admin') return;
    if (company_id !== companyId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'No access to this company' } });
    }
  };
}
