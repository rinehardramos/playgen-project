import { describe, it, expect, beforeAll } from 'vitest';
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../../src/services/jwtService';
import type { JwtPayload } from '@playgen/types';

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
});

const mockPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
  sub: 'user-uuid-123',
  company_id: 'company-uuid-456',
  station_ids: ['station-uuid-789'],
  role_code: 'scheduler',
  permissions: ['playlist:read', 'playlist:write'],
};

describe('signAccessToken / verifyAccessToken', () => {
  it('signs and verifies a valid access token', () => {
    const token = signAccessToken(mockPayload);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe(mockPayload.sub);
    expect(decoded.company_id).toBe(mockPayload.company_id);
    expect(decoded.station_ids).toEqual(mockPayload.station_ids);
    expect(decoded.role_code).toBe(mockPayload.role_code);
    expect(decoded.permissions).toEqual(mockPayload.permissions);
  });

  it('throws on a tampered access token', () => {
    const token = signAccessToken(mockPayload);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('throws on a token signed with wrong secret', () => {
    const badToken = signAccessToken(mockPayload).replace(
      process.env.JWT_ACCESS_SECRET!,
      'wrong-secret'
    );
    // Sign with a different secret to force failure
    process.env.JWT_ACCESS_SECRET = 'totally-different-secret-for-test';
    expect(() => verifyAccessToken(badToken)).toThrow();
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough';
  });

  it('includes iat and exp claims', () => {
    const token = signAccessToken(mockPayload);
    const decoded = verifyAccessToken(token);
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
  });
});

describe('signRefreshToken / verifyRefreshToken', () => {
  it('signs and verifies a valid refresh token', () => {
    const token = signRefreshToken('user-uuid-123');
    const decoded = verifyRefreshToken(token);
    expect(decoded.sub).toBe('user-uuid-123');
  });

  it('throws on a tampered refresh token', () => {
    const token = signRefreshToken('user-uuid-123');
    const tampered = token.slice(0, -3) + 'XXX';
    expect(() => verifyRefreshToken(tampered)).toThrow();
  });

  it('refresh token does not contain sensitive payload fields', () => {
    const token = signRefreshToken('user-uuid-123');
    const decoded = verifyRefreshToken(token);
    expect((decoded as Record<string, unknown>).permissions).toBeUndefined();
    expect((decoded as Record<string, unknown>).company_id).toBeUndefined();
  });
});
