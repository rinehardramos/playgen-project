import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkTierLimit, checkFeatureGate, getCompanyTier } from './index';
import type { Pool } from 'pg';

// ─── Mock pg Pool ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockPool = { query: mockQuery } as unknown as Pool;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a row as returned by the checkTierLimit query.
 * Defaults represent a free-tier company with 0 current resources and
 * free-tier defaults (max_stations=1, max_users=2, max_songs=500).
 */
function makeLimitRow(overrides: Partial<{
  tier: string;
  max_stations: number;
  max_users: number;
  max_songs: number;
  station_count: string;
  user_count: string;
  song_count: string;
}> = {}) {
  return {
    tier: 'free',
    max_stations: 1,
    max_users: 2,
    max_songs: 500,
    station_count: '0',
    user_count: '0',
    song_count: '0',
    ...overrides,
  };
}

// ─── checkTierLimit ───────────────────────────────────────────────────────────

describe('checkTierLimit', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── free tier limits ──────────────────────────────────────────────────────

  it('free tier: max 1 station — allowed when current=0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeLimitRow({ tier: 'free', max_stations: 1, station_count: '0' })],
    });

    const result = await checkTierLimit(mockPool, 'company-001', 'stations');

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(0);
    expect(result.limit).toBe(1);
    expect(result.tier).toBe('free');
  });

  it('free tier: max 1 station — denied when current=1 (at limit)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeLimitRow({ tier: 'free', max_stations: 1, station_count: '1' })],
    });

    const result = await checkTierLimit(mockPool, 'company-001', 'stations');

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(1);
    expect(result.limit).toBe(1);
    expect(result.tier).toBe('free');
  });

  it('free tier: denied when station_count exceeds max', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeLimitRow({ tier: 'free', max_stations: 1, station_count: '2' })],
    });

    const result = await checkTierLimit(mockPool, 'company-001', 'stations');

    expect(result.allowed).toBe(false);
  });

  // ── enterprise unlimited (max=-1) ─────────────────────────────────────────

  it('enterprise tier: max=-1 (unlimited) — always allowed regardless of count', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeLimitRow({ tier: 'enterprise', max_stations: -1, station_count: '999' })],
    });

    const result = await checkTierLimit(mockPool, 'company-001', 'stations');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(-1);
    expect(result.tier).toBe('enterprise');
  });

  it('enterprise tier: unlimited users — allowed with high count', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeLimitRow({ tier: 'enterprise', max_users: -1, user_count: '500' })],
    });

    const result = await checkTierLimit(mockPool, 'company-001', 'users');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(-1);
  });

  // ── resource variants ─────────────────────────────────────────────────────

  it('checks users resource correctly', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeLimitRow({ tier: 'starter', max_users: 10, user_count: '5' })],
    });

    const result = await checkTierLimit(mockPool, 'company-001', 'users');

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(5);
    expect(result.limit).toBe(10);
  });

  it('checks songs resource correctly', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeLimitRow({ tier: 'free', max_songs: 500, song_count: '500' })],
    });

    const result = await checkTierLimit(mockPool, 'company-001', 'songs');

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(500);
    expect(result.limit).toBe(500);
  });

  // ── no subscription found → defaults to free ─────────────────────────────

  it('defaults to free tier limits when no subscription found (empty rows)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkTierLimit(mockPool, 'company-001', 'stations');

    expect(result.allowed).toBe(false);
    expect(result.tier).toBe('free');
    expect(result.current).toBe(0);
    expect(result.limit).toBe(0);
  });
});

// ─── checkFeatureGate ─────────────────────────────────────────────────────────

describe('checkFeatureGate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('starter tier: feature_dj=true → returns true for "dj"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ enabled: true }] });

    const result = await checkFeatureGate(mockPool, 'company-001', 'dj');

    expect(result).toBe(true);
  });

  it('starter tier: feature_analytics=false → returns false for "analytics"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ enabled: false }] });

    const result = await checkFeatureGate(mockPool, 'company-001', 'analytics');

    expect(result).toBe(false);
  });

  it('enterprise tier: feature_hierarchy=true → returns true for "hierarchy"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ enabled: true }] });

    const result = await checkFeatureGate(mockPool, 'company-001', 'hierarchy');

    expect(result).toBe(true);
  });

  it('returns false when row has enabled=false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ enabled: false }] });

    const result = await checkFeatureGate(mockPool, 'company-001', 's3');

    expect(result).toBe(false);
  });

  it('returns false when no rows returned (no subscription)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkFeatureGate(mockPool, 'company-001', 'custom_roles');

    expect(result).toBe(false);
  });

  it('queries the correct column for each feature', async () => {
    const featureColumnMap: Array<[string, string]> = [
      ['dj',           'feature_dj'],
      ['analytics',    'feature_analytics'],
      ['s3',           'feature_s3'],
      ['api_keys',     'feature_api_keys'],
      ['custom_roles', 'feature_custom_roles'],
      ['hierarchy',    'feature_hierarchy'],
    ];

    for (const [feature, column] of featureColumnMap) {
      mockQuery.mockResolvedValueOnce({ rows: [{ enabled: true }] });

      await checkFeatureGate(mockPool, 'company-001', feature as import('@playgen/types').TierFeature);

      const callSql = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0] as string;
      expect(callSql, `feature "${feature}" should query column "${column}"`).toContain(column);
    }
  });
});

// ─── getCompanyTier ───────────────────────────────────────────────────────────

describe('getCompanyTier', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns "starter" when subscription.tier = "starter"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'starter' }] });

    const tier = await getCompanyTier(mockPool, 'company-001');

    expect(tier).toBe('starter');
  });

  it('returns "professional" when subscription.tier = "professional"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'professional' }] });

    const tier = await getCompanyTier(mockPool, 'company-001');

    expect(tier).toBe('professional');
  });

  it('returns "enterprise" when subscription.tier = "enterprise"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'enterprise' }] });

    const tier = await getCompanyTier(mockPool, 'company-001');

    expect(tier).toBe('enterprise');
  });

  it('returns "free" when no active subscription found (empty rows)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const tier = await getCompanyTier(mockPool, 'company-001');

    expect(tier).toBe('free');
  });

  it('passes companyId as query parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tier: 'starter' }] });

    await getCompanyTier(mockPool, 'company-abc-123');

    expect(mockQuery.mock.calls[0][1]).toContain('company-abc-123');
  });
});
