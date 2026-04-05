import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@playgen/middleware';
import { getPool } from '../db';
import type { SubscriptionTier } from '@playgen/types';

interface SubscriptionRow {
  id: string;
  company_id: string;
  stripe_subscription_id: string | null;
  tier: SubscriptionTier;
  status: string;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  created_at: Date;
  updated_at: Date;
}

interface TierLimitsRow {
  tier: SubscriptionTier;
  max_stations: number;
  max_users: number;
  max_songs: number;
  max_sub_stations: number;
  feature_dj: boolean;
  feature_analytics: boolean;
  feature_s3: boolean;
  feature_api_keys: boolean;
  feature_custom_roles: boolean;
  feature_hierarchy: boolean;
}

interface UsageRow {
  station_count: string;
  user_count: string;
  song_count: string;
}

export async function subscriptionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  /**
   * GET /companies/:id/subscription
   * Returns the active subscription tier, limits, and current resource usage.
   * Requires billing:read permission.
   */
  app.get('/companies/:id/subscription', { onRequest: [requirePermission('billing:read')] }, async (req, reply) => {
    const { id: companyId } = req.params as { id: string };

    // Company isolation: non-sys callers can only view their own company
    const caller = req.user;
    if (!caller.sys && caller.cid !== companyId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Company access denied' } });
    }

    const pool = getPool();

    // Fetch subscription + tier limits in one query
    const { rows: subRows } = await pool.query<SubscriptionRow & TierLimitsRow>(
      `SELECT
         s.id, s.company_id, s.stripe_subscription_id, s.tier, s.status,
         s.current_period_start, s.current_period_end, s.cancel_at_period_end,
         s.created_at, s.updated_at,
         COALESCE(tl.max_stations, 1)         AS max_stations,
         COALESCE(tl.max_users, 2)            AS max_users,
         COALESCE(tl.max_songs, 500)          AS max_songs,
         COALESCE(tl.max_sub_stations, 0)     AS max_sub_stations,
         COALESCE(tl.feature_dj, FALSE)           AS feature_dj,
         COALESCE(tl.feature_analytics, FALSE)    AS feature_analytics,
         COALESCE(tl.feature_s3, FALSE)           AS feature_s3,
         COALESCE(tl.feature_api_keys, FALSE)     AS feature_api_keys,
         COALESCE(tl.feature_custom_roles, FALSE) AS feature_custom_roles,
         COALESCE(tl.feature_hierarchy, FALSE)    AS feature_hierarchy
       FROM subscriptions s
       LEFT JOIN subscription_tier_limits tl ON tl.tier = s.tier
       WHERE s.company_id = $1
         AND s.status IN ('active', 'trialing', 'past_due')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [companyId],
    );

    // Fetch current resource usage counts
    const { rows: usageRows } = await pool.query<UsageRow>(
      `SELECT
         (SELECT COUNT(*) FROM stations WHERE company_id = $1 AND is_active = TRUE)::text AS station_count,
         (SELECT COUNT(*) FROM users    WHERE company_id = $1 AND is_active = TRUE)::text AS user_count,
         (SELECT COUNT(*) FROM songs    WHERE company_id = $1)::text                      AS song_count`,
      [companyId],
    );

    const usage = usageRows[0] ?? { station_count: '0', user_count: '0', song_count: '0' };

    if (subRows.length === 0) {
      // No active subscription — return free tier defaults
      const { rows: freeTierRows } = await pool.query<TierLimitsRow>(
        `SELECT * FROM subscription_tier_limits WHERE tier = 'free'`,
      );
      const freeTier = freeTierRows[0];

      return {
        subscription: null,
        tier: 'free' as SubscriptionTier,
        limits: freeTier ?? {
          tier: 'free',
          max_stations: 1,
          max_users: 2,
          max_songs: 500,
          max_sub_stations: 0,
          feature_dj: false,
          feature_analytics: false,
          feature_s3: false,
          feature_api_keys: false,
          feature_custom_roles: false,
          feature_hierarchy: false,
        },
        usage: {
          stations: { current: parseInt(usage.station_count), limit: freeTier?.max_stations ?? 1 },
          users:    { current: parseInt(usage.user_count),    limit: freeTier?.max_users ?? 2 },
          songs:    { current: parseInt(usage.song_count),    limit: freeTier?.max_songs ?? 500 },
        },
      };
    }

    const sub = subRows[0];

    return {
      subscription: {
        id: sub.id,
        company_id: sub.company_id,
        stripe_subscription_id: sub.stripe_subscription_id,
        tier: sub.tier,
        status: sub.status,
        current_period_start: sub.current_period_start,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        created_at: sub.created_at,
        updated_at: sub.updated_at,
      },
      tier: sub.tier,
      limits: {
        tier: sub.tier,
        max_stations: sub.max_stations,
        max_users: sub.max_users,
        max_songs: sub.max_songs,
        max_sub_stations: sub.max_sub_stations,
        feature_dj: sub.feature_dj,
        feature_analytics: sub.feature_analytics,
        feature_s3: sub.feature_s3,
        feature_api_keys: sub.feature_api_keys,
        feature_custom_roles: sub.feature_custom_roles,
        feature_hierarchy: sub.feature_hierarchy,
      },
      usage: {
        stations: { current: parseInt(usage.station_count), limit: sub.max_stations },
        users:    { current: parseInt(usage.user_count),    limit: sub.max_users },
        songs:    { current: parseInt(usage.song_count),    limit: sub.max_songs },
      },
    };
  });
}
