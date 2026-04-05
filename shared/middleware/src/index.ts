import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import type { JwtPayload, SubscriptionTier, TierFeature } from '@playgen/types';

const ACCESS_SECRET = () =>
  process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-in-prod';

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload & {
      sub: string;
      cid: string;
      rc: string;
      tier: SubscriptionTier;
      sys?: true;
      pv: number;
    };
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } }) as unknown as void;
  }
  try {
    req.user = jwt.verify(authHeader.slice(7), ACCESS_SECRET()) as JwtPayload & {
      sub: string;
      cid: string;
      rc: string;
      tier: SubscriptionTier;
      sys?: true;
      pv: number;
    };
  } catch {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }) as unknown as void;
  }
}

export function requirePermission(permission: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = req.user;
    if (!user) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }) as unknown as void;
    }

    // sys flag: super_admin / company_admin have all permissions
    if (user.sys) return;

    // Check resolved permissions if available (attached by resolvePermissions middleware)
    const resolved = (req as unknown as { resolvedPerms?: { companyWide: string[] } }).resolvedPerms;
    if (resolved) {
      if (!resolved.companyWide.includes(permission)) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: `Permission denied: ${permission}` } }) as unknown as void;
      }
      return;
    }

    // Fallback: check ROLE_PERMISSIONS for the user's role code
    const { ROLE_PERMISSIONS } = await import('@playgen/types');
    const perms = ROLE_PERMISSIONS[user.rc] ?? [];
    if (!perms.includes(permission)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: `Permission denied: ${permission}` } }) as unknown as void;
    }
  };
}

export function requireStationAccess(stationIdParam = 'stationId') {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = req.user;
    if (!user) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }) as unknown as void;
    }
    if (user.sys) return;

    const params = req.params as Record<string, string>;
    // Support both the explicit param name and legacy fallbacks (id, station_id)
    const stationId = params[stationIdParam] ?? params.id ?? params.station_id;
    if (!stationId) return;

    // Check resolved permissions stationSpecific map
    const resolved = (req as unknown as { resolvedPerms?: { accessibleStationIds: string[] } }).resolvedPerms;
    if (resolved) {
      if (!resolved.accessibleStationIds.includes(stationId)) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Station access denied' } }) as unknown as void;
      }
      return;
    }

    // Fallback: check user_station_assignments in DB (or station_ids array for backward compat)
    // This path is used before the Redis cache is warm
    const pool = (req.server as unknown as { pg?: { query: (...args: unknown[]) => Promise<{ rows: unknown[] }> } }).pg;
    if (pool) {
      const result = await pool.query(
        `SELECT 1 FROM user_station_assignments WHERE user_id = $1 AND station_id = $2
         UNION ALL
         SELECT 1 FROM users WHERE id = $1 AND $2::uuid = ANY(station_ids)
         LIMIT 1`,
        [user.sub, stationId],
      );
      if (!result.rows.length) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Station access denied' } }) as unknown as void;
      }
    }
  };
}

export function requireCompanyMatch(companyIdParam = 'id') {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = req.user;
    if (!user) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }) as unknown as void;
    }
    if (user.sys) return;

    const params = req.params as Record<string, string>;
    // Support both the explicit param name and legacy fallbacks
    const companyId = params[companyIdParam] ?? params.company_id;
    if (companyId && companyId !== user.cid) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Company access denied' } }) as unknown as void;
    }
  };
}

/**
 * requireFeature — checks subscription tier feature gates.
 * Uses the tier embedded in the JWT for a fast, DB-free check.
 * Usage: preHandler: [authenticate, requireFeature('dj')]
 */
export function requireFeature(feature: TierFeature) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = req.user;
    if (!user) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }) as unknown as void;
    }
    if (user.sys) return; // super_admin bypasses feature gates

    // Quick check by tier from JWT before hitting DB
    const tierFeatureMap: Record<string, TierFeature[]> = {
      enterprise:    ['dj', 'analytics', 's3', 'api_keys', 'custom_roles', 'hierarchy'],
      professional:  ['dj', 'analytics', 's3', 'api_keys', 'custom_roles'],
      starter:       ['dj'],
      free:          [],
    };

    const allowedFeatures = tierFeatureMap[user.tier] ?? [];
    if (!allowedFeatures.includes(feature)) {
      return reply.code(403).send({
        error: {
          code: 'FEATURE_NOT_AVAILABLE',
          message: `Feature '${feature}' is not available on the ${user.tier} plan. Please upgrade.`,
          upgrade_required: true,
        },
      }) as unknown as void;
    }
  };
}
