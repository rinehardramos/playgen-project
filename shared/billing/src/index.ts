import type { Pool } from 'pg';
import type { TierCheckResult, TierFeature, TierResource, SubscriptionTier } from '@playgen/types';

export type { TierCheckResult, TierFeature, TierResource, SubscriptionTier };

/**
 * Check if a company has room to add more of a given resource.
 * Returns allowed=true if under limit or tier is enterprise (unlimited, -1).
 */
export async function checkTierLimit(
  pool: Pool,
  companyId: string,
  resource: TierResource,
): Promise<TierCheckResult> {
  const { rows } = await pool.query<{
    tier: SubscriptionTier;
    max_stations: number;
    max_users: number;
    max_songs: number;
    station_count: string;
    user_count: string;
    song_count: string;
  }>(`
    SELECT
      COALESCE(s.tier, 'free') AS tier,
      COALESCE(tl.max_stations, 1) AS max_stations,
      COALESCE(tl.max_users,   2) AS max_users,
      COALESCE(tl.max_songs,   500) AS max_songs,
      (SELECT COUNT(*) FROM stations WHERE company_id = $1 AND is_active = TRUE) AS station_count,
      (SELECT COUNT(*) FROM users    WHERE company_id = $1 AND is_active = TRUE) AS user_count,
      (SELECT COUNT(*) FROM songs    WHERE company_id = $1) AS song_count
    FROM companies c
    LEFT JOIN subscriptions s ON s.company_id = c.id
      AND s.status IN ('active', 'trialing', 'past_due')
    LEFT JOIN subscription_tier_limits tl ON tl.tier = COALESCE(s.tier, 'free')
    WHERE c.id = $1
    LIMIT 1
  `, [companyId]);

  const row = rows[0];
  if (!row) return { allowed: false, current: 0, limit: 0, tier: 'free' };

  const countMap: Record<TierResource, number> = {
    stations: parseInt(row.station_count),
    users: parseInt(row.user_count),
    songs: parseInt(row.song_count),
  };
  const limitMap: Record<TierResource, number> = {
    stations: row.max_stations,
    users: row.max_users,
    songs: row.max_songs,
  };

  const current = countMap[resource];
  const limit = limitMap[resource];
  const allowed = limit === -1 || current < limit;

  return { allowed, current, limit, tier: row.tier };
}

/**
 * Check if a company's subscription includes a specific feature.
 */
export async function checkFeatureGate(
  pool: Pool,
  companyId: string,
  feature: TierFeature,
): Promise<boolean> {
  const featureCol: Record<TierFeature, string> = {
    dj:           'feature_dj',
    analytics:    'feature_analytics',
    s3:           'feature_s3',
    api_keys:     'feature_api_keys',
    custom_roles: 'feature_custom_roles',
    hierarchy:    'feature_hierarchy',
  };

  const col = featureCol[feature];
  const { rows } = await pool.query<{ enabled: boolean }>(`
    SELECT COALESCE(tl.${col}, FALSE) AS enabled
    FROM companies c
    LEFT JOIN subscriptions s ON s.company_id = c.id
      AND s.status IN ('active', 'trialing', 'past_due')
    LEFT JOIN subscription_tier_limits tl ON tl.tier = COALESCE(s.tier, 'free')
    WHERE c.id = $1
    LIMIT 1
  `, [companyId]);

  return rows[0]?.enabled ?? false;
}

/**
 * Get the active tier for a company.
 */
export async function getCompanyTier(
  pool: Pool,
  companyId: string,
): Promise<SubscriptionTier> {
  const { rows } = await pool.query<{ tier: SubscriptionTier }>(`
    SELECT COALESCE(s.tier, 'free') AS tier
    FROM companies c
    LEFT JOIN subscriptions s ON s.company_id = c.id
      AND s.status IN ('active', 'trialing', 'past_due')
    WHERE c.id = $1
    LIMIT 1
  `, [companyId]);
  return rows[0]?.tier ?? 'free';
}
