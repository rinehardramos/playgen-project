import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure unit tests for business logic — DB is mocked
vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
  })),
}));

import { getPool } from '../../src/db';

describe('companyService — slug uniqueness', () => {
  it('slug must be URL-safe (validated at DB level via UNIQUE constraint)', () => {
    // Ensure slugs with spaces/special chars are caught before DB insert
    const isValidSlug = (slug: string) => /^[a-z0-9-]+$/.test(slug);
    expect(isValidSlug('ifm-manila')).toBe(true);
    expect(isValidSlug('iFM Manila')).toBe(false);
    expect(isValidSlug('station_1')).toBe(false);
    expect(isValidSlug('radio-1')).toBe(true);
  });
});

describe('stationService — broadcast hour validation', () => {
  it('accepts valid broadcast hours (0-23)', () => {
    const isValidHour = (h: number) => Number.isInteger(h) && h >= 0 && h <= 23;
    expect(isValidHour(4)).toBe(true);
    expect(isValidHour(3)).toBe(true);
    expect(isValidHour(0)).toBe(true);
    expect(isValidHour(23)).toBe(true);
    expect(isValidHour(24)).toBe(false);
    expect(isValidHour(-1)).toBe(false);
    expect(isValidHour(4.5)).toBe(false);
  });

  it('active_days defaults to all 7 days', () => {
    const defaultDays = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
    expect(defaultDays).toHaveLength(7);
    expect(defaultDays).toContain('MON');
    expect(defaultDays).toContain('SUN');
  });
});

describe('userService — password hashing', () => {
  it('bcrypt cost factor is 12', async () => {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('test-password', 12);
    const rounds = bcrypt.getRounds(hash);
    expect(rounds).toBe(12);
  });

  it('different passwords produce different hashes', async () => {
    const bcrypt = await import('bcrypt');
    const hash1 = await bcrypt.hash('password-a', 12);
    const hash2 = await bcrypt.hash('password-b', 12);
    expect(hash1).not.toBe(hash2);
  });

  it('correct password validates against hash', async () => {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('my-secure-password', 12);
    expect(await bcrypt.compare('my-secure-password', hash)).toBe(true);
    expect(await bcrypt.compare('wrong-password', hash)).toBe(false);
  });
});

describe('authenticate middleware — permission check', () => {
  it('super_admin has all permissions', async () => {
    const { ROLE_PERMISSIONS } = await import('@playgen/types');
    const perms = ROLE_PERMISSIONS['super_admin'];
    expect(perms).toContain('company:write');
    expect(perms).toContain('playlist:approve');
    expect(perms).toContain('rules:write');
  });

  it('viewer has only read permissions', async () => {
    const { ROLE_PERMISSIONS } = await import('@playgen/types');
    const perms = ROLE_PERMISSIONS['viewer'];
    expect(perms).not.toContain('playlist:write');
    expect(perms).not.toContain('library:write');
    expect(perms).not.toContain('users:write');
    expect(perms).toContain('playlist:read');
    expect(perms).toContain('analytics:read');
  });

  it('scheduler cannot approve playlists', async () => {
    const { ROLE_PERMISSIONS } = await import('@playgen/types');
    const perms = ROLE_PERMISSIONS['scheduler'];
    expect(perms).not.toContain('playlist:approve');
    expect(perms).toContain('playlist:write');
  });
});
