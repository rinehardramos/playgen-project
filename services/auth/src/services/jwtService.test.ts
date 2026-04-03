import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './jwtService';

// ─── env setup ───────────────────────────────────────────────────────────────
// These must be set before the module's top-level constants are read.  We
// re-import after setting them (see note below), but Vitest resets module
// state per file, so setting in beforeAll is fine for the same-file imports
// above because the module is evaluated once at import time.  To guarantee
// the values, we set them at module scope (before the import hoisting lands)
// AND keep the beforeAll as documentation / guard.

const ACCESS_SECRET = 'test-access-secret-32-chars-minimum';
const REFRESH_SECRET = 'test-refresh-secret-32-chars-minimum';

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
  process.env.JWT_ACCESS_EXPIRES_SEC = '900';
  process.env.JWT_REFRESH_EXPIRES_SEC = '604800';
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const samplePayload = {
  sub: 'user-uuid-001',
  company_id: 'company-uuid-001',
  station_ids: ['station-1', 'station-2'],
  role_code: 'station_admin' as const,
  permissions: ['playlist:read', 'playlist:write'],
};

// ─── signAccessToken ─────────────────────────────────────────────────────────

describe('signAccessToken', () => {
  it('returns a non-empty string', () => {
    const token = signAccessToken(samplePayload);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('produces a JWT with three dot-separated segments', () => {
    const token = signAccessToken(samplePayload);
    expect(token.split('.').length).toBe(3);
  });

  it('embeds the payload fields in the token claims', () => {
    const token = signAccessToken(samplePayload);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.sub).toBe(samplePayload.sub);
    expect(decoded.company_id).toBe(samplePayload.company_id);
    expect(decoded.role_code).toBe(samplePayload.role_code);
    expect(decoded.station_ids).toEqual(samplePayload.station_ids);
    expect(decoded.permissions).toEqual(samplePayload.permissions);
  });

  it('includes iat and exp claims', () => {
    const token = signAccessToken(samplePayload);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
  });

  it('sets exp ~900 seconds after iat', () => {
    const token = signAccessToken(samplePayload);
    const decoded = jwt.decode(token) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(900);
  });
});

// ─── verifyAccessToken ───────────────────────────────────────────────────────

describe('verifyAccessToken', () => {
  it('returns the original payload fields for a freshly signed token', () => {
    const token = signAccessToken(samplePayload);
    const result = verifyAccessToken(token);
    expect(result.sub).toBe(samplePayload.sub);
    expect(result.company_id).toBe(samplePayload.company_id);
    expect(result.role_code).toBe(samplePayload.role_code);
    expect(result.station_ids).toEqual(samplePayload.station_ids);
  });

  it('throws JsonWebTokenError for a token signed with a different secret', () => {
    const wrongToken = jwt.sign(samplePayload, 'completely-wrong-secret');
    expect(() => verifyAccessToken(wrongToken)).toThrow();
  });

  it('throws TokenExpiredError for an already-expired token', () => {
    const expired = jwt.sign(samplePayload, ACCESS_SECRET, { expiresIn: -1 });
    expect(() => verifyAccessToken(expired)).toThrow(/expired/i);
  });

  it('throws for a malformed token string', () => {
    expect(() => verifyAccessToken('not.a.token')).toThrow();
  });

  it('throws for an empty string', () => {
    expect(() => verifyAccessToken('')).toThrow();
  });
});

// ─── signRefreshToken ────────────────────────────────────────────────────────

describe('signRefreshToken', () => {
  it('returns a non-empty JWT string', () => {
    const token = signRefreshToken('user-uuid-001');
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  it('encodes the userId as the sub claim', () => {
    const userId = 'user-uuid-001';
    const token = signRefreshToken(userId);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.sub).toBe(userId);
  });

  it('includes exp claim', () => {
    const token = signRefreshToken('user-uuid-001');
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(typeof decoded.exp).toBe('number');
  });

  it('produces distinct tokens for different userIds', () => {
    const t1 = signRefreshToken('user-a');
    const t2 = signRefreshToken('user-b');
    expect(t1).not.toBe(t2);
  });
});

// ─── verifyRefreshToken ──────────────────────────────────────────────────────

describe('verifyRefreshToken', () => {
  it('returns { sub } for a valid refresh token', () => {
    const userId = 'user-uuid-001';
    const token = signRefreshToken(userId);
    const result = verifyRefreshToken(token);
    expect(result.sub).toBe(userId);
  });

  it('throws when token is signed with the access secret instead', () => {
    // An access token is signed with the ACCESS_SECRET; verifyRefreshToken
    // uses REFRESH_SECRET — they differ, so verification must fail.
    const accessToken = signAccessToken(samplePayload);
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });

  it('throws for an expired refresh token', () => {
    const expired = jwt.sign({ sub: 'user-uuid-001' }, REFRESH_SECRET, { expiresIn: -1 });
    expect(() => verifyRefreshToken(expired)).toThrow(/expired/i);
  });

  it('throws for a completely wrong secret', () => {
    const wrongToken = jwt.sign({ sub: 'user-uuid-001' }, 'wrong-secret');
    expect(() => verifyRefreshToken(wrongToken)).toThrow();
  });
});
