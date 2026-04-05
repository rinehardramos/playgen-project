import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ─── Env setup (must precede module imports) ─────────────────────────────────

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-secret-min-32-chars-long-enough';
});

// ─── Mock jsonwebtoken ────────────────────────────────────────────────────────
// vi.mock must be hoisted before imports. The fake verifier decodes a
// base64-encoded JSON string so tests can pass arbitrary payloads as tokens.

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn((token: string) => {
      return JSON.parse(Buffer.from(token, 'base64').toString());
    }),
    sign: vi.fn(() => 'mock-token'),
  },
}));

import { requireFeature, requirePermission } from './index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Encode an arbitrary object as a base64 "token" for the mock jwt.verify. */
function makeToken(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/** Build a minimal FastifyRequest-like object with req.user pre-populated. */
function makeReq(payload: object): FastifyRequest {
  return {
    headers: { authorization: `Bearer ${makeToken(payload)}` },
    user: payload,
  } as unknown as FastifyRequest;
}

/** Capture reply.code(n).send(body) calls. */
function makeReply() {
  const reply = {
    _code: 0,
    _body: undefined as unknown,
    code(n: number) {
      this._code = n;
      return this;
    },
    send(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return reply;
}

// ─── requireFeature ───────────────────────────────────────────────────────────

describe('requireFeature', () => {
  // ── free tier ────────────────────────────────────────────────────────────────

  it('free tier cannot access "dj"', async () => {
    const req = makeReq({ sub: 'u1', cid: 'c1', rc: 'viewer', tier: 'free', pv: 1 });
    const reply = makeReply();

    await requireFeature('dj')(req, reply as unknown as FastifyReply);

    expect(reply._code).toBe(403);
    expect((reply._body as { error: { code: string } }).error.code).toBe('FEATURE_NOT_AVAILABLE');
  });

  it('free tier cannot access "analytics"', async () => {
    const req = makeReq({ sub: 'u1', cid: 'c1', rc: 'viewer', tier: 'free', pv: 1 });
    const reply = makeReply();

    await requireFeature('analytics')(req, reply as unknown as FastifyReply);

    expect(reply._code).toBe(403);
    expect((reply._body as { error: { code: string } }).error.code).toBe('FEATURE_NOT_AVAILABLE');
  });

  // ── starter tier ─────────────────────────────────────────────────────────────

  it('starter tier CAN access "dj"', async () => {
    const req = makeReq({ sub: 'u2', cid: 'c1', rc: 'station_admin', tier: 'starter', pv: 1 });
    const reply = makeReply();

    await requireFeature('dj')(req, reply as unknown as FastifyReply);

    // No 403 — reply.code should not have been called with 403
    expect(reply._code).not.toBe(403);
  });

  it('starter tier cannot access "analytics"', async () => {
    const req = makeReq({ sub: 'u2', cid: 'c1', rc: 'station_admin', tier: 'starter', pv: 1 });
    const reply = makeReply();

    await requireFeature('analytics')(req, reply as unknown as FastifyReply);

    expect(reply._code).toBe(403);
    expect((reply._body as { error: { upgrade_required: boolean } }).error.upgrade_required).toBe(true);
  });

  // ── professional tier ────────────────────────────────────────────────────────

  it('professional tier CAN access "dj"', async () => {
    const req = makeReq({ sub: 'u3', cid: 'c1', rc: 'station_admin', tier: 'professional', pv: 1 });
    const reply = makeReply();

    await requireFeature('dj')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  it('professional tier CAN access "analytics"', async () => {
    const req = makeReq({ sub: 'u3', cid: 'c1', rc: 'station_admin', tier: 'professional', pv: 1 });
    const reply = makeReply();

    await requireFeature('analytics')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  it('professional tier CAN access "s3"', async () => {
    const req = makeReq({ sub: 'u3', cid: 'c1', rc: 'station_admin', tier: 'professional', pv: 1 });
    const reply = makeReply();

    await requireFeature('s3')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  it('professional tier CAN access "api_keys"', async () => {
    const req = makeReq({ sub: 'u3', cid: 'c1', rc: 'station_admin', tier: 'professional', pv: 1 });
    const reply = makeReply();

    await requireFeature('api_keys')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  it('professional tier CAN access "custom_roles"', async () => {
    const req = makeReq({ sub: 'u3', cid: 'c1', rc: 'station_admin', tier: 'professional', pv: 1 });
    const reply = makeReply();

    await requireFeature('custom_roles')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  it('professional tier cannot access "hierarchy"', async () => {
    const req = makeReq({ sub: 'u3', cid: 'c1', rc: 'station_admin', tier: 'professional', pv: 1 });
    const reply = makeReply();

    await requireFeature('hierarchy')(req, reply as unknown as FastifyReply);

    expect(reply._code).toBe(403);
    expect((reply._body as { error: { code: string } }).error.code).toBe('FEATURE_NOT_AVAILABLE');
  });

  // ── enterprise tier ──────────────────────────────────────────────────────────

  it('enterprise tier CAN access "dj"', async () => {
    const req = makeReq({ sub: 'u4', cid: 'c1', rc: 'company_admin', tier: 'enterprise', sys: true, pv: 1 });
    const reply = makeReply();

    await requireFeature('dj')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  it('enterprise tier CAN access "hierarchy"', async () => {
    const req = makeReq({ sub: 'u4', cid: 'c1', rc: 'station_admin', tier: 'enterprise', pv: 1 });
    const reply = makeReply();

    await requireFeature('hierarchy')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  it('enterprise tier CAN access all six features', async () => {
    const features = ['dj', 'analytics', 's3', 'api_keys', 'custom_roles', 'hierarchy'] as const;
    for (const feature of features) {
      const req = makeReq({ sub: 'u4', cid: 'c1', rc: 'station_admin', tier: 'enterprise', pv: 1 });
      const reply = makeReply();

      await requireFeature(feature)(req, reply as unknown as FastifyReply);

      expect(reply._code, `enterprise should access ${feature}`).not.toBe(403);
    }
  });

  // ── sys bypass ───────────────────────────────────────────────────────────────

  it('sys=true bypasses all feature gates (even on free tier)', async () => {
    const features = ['dj', 'analytics', 's3', 'api_keys', 'custom_roles', 'hierarchy'] as const;
    for (const feature of features) {
      const req = makeReq({ sub: 'sa', cid: 'c1', rc: 'super_admin', tier: 'free', sys: true as const, pv: 1 });
      const reply = makeReply();

      await requireFeature(feature)(req, reply as unknown as FastifyReply);

      expect(reply._code, `sys user should bypass gate for ${feature}`).not.toBe(403);
    }
  });

  // ── error message content ────────────────────────────────────────────────────

  it('FEATURE_NOT_AVAILABLE error body contains upgrade_required=true', async () => {
    const req = makeReq({ sub: 'u1', cid: 'c1', rc: 'viewer', tier: 'free', pv: 1 });
    const reply = makeReply();

    await requireFeature('dj')(req, reply as unknown as FastifyReply);

    const body = reply._body as { error: { code: string; upgrade_required: boolean; message: string } };
    expect(body.error.upgrade_required).toBe(true);
    expect(body.error.message).toContain('free');
  });
});

// ─── requirePermission ────────────────────────────────────────────────────────

describe('requirePermission', () => {
  // ── sys bypass ───────────────────────────────────────────────────────────────

  it('sys=true bypasses permission check entirely', async () => {
    const req = makeReq({ sub: 'sa', cid: 'c1', rc: 'super_admin', tier: 'free', sys: true as const, pv: 1 });
    const reply = makeReply();

    await requirePermission('roles:write')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  // ── station_admin role ───────────────────────────────────────────────────────

  it('station_admin role has "playlist:read"', async () => {
    const req = makeReq({ sub: 'u5', cid: 'c1', rc: 'station_admin', tier: 'starter', pv: 1 });
    const reply = makeReply();

    await requirePermission('playlist:read')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  it('station_admin role has "dj:write"', async () => {
    const req = makeReq({ sub: 'u5', cid: 'c1', rc: 'station_admin', tier: 'starter', pv: 1 });
    const reply = makeReply();

    await requirePermission('dj:write')(req, reply as unknown as FastifyReply);

    expect(reply._code).not.toBe(403);
  });

  // ── viewer role ──────────────────────────────────────────────────────────────

  it('viewer role does NOT have "roles:write"', async () => {
    const req = makeReq({ sub: 'u6', cid: 'c1', rc: 'viewer', tier: 'starter', pv: 1 });
    const reply = makeReply();

    await requirePermission('roles:write')(req, reply as unknown as FastifyReply);

    expect(reply._code).toBe(403);
    expect((reply._body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('viewer role does NOT have "playlist:write"', async () => {
    const req = makeReq({ sub: 'u6', cid: 'c1', rc: 'viewer', tier: 'starter', pv: 1 });
    const reply = makeReply();

    await requirePermission('playlist:write')(req, reply as unknown as FastifyReply);

    expect(reply._code).toBe(403);
  });

  // ── unknown role ─────────────────────────────────────────────────────────────

  it('unknown role gets empty permissions and results in 403', async () => {
    const req = makeReq({ sub: 'u7', cid: 'c1', rc: 'nonexistent_role', tier: 'starter', pv: 1 });
    const reply = makeReply();

    await requirePermission('playlist:read')(req, reply as unknown as FastifyReply);

    expect(reply._code).toBe(403);
    expect((reply._body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  // ── resolvedPerms fallback ────────────────────────────────────────────────────

  it('uses resolvedPerms.companyWide when present on request', async () => {
    const req = makeReq({ sub: 'u8', cid: 'c1', rc: 'viewer', tier: 'starter', pv: 1 });
    // Attach resolved perms (as the resolvePermissions middleware would)
    (req as unknown as { resolvedPerms: { companyWide: string[] } }).resolvedPerms = {
      companyWide: ['playlist:read', 'playlist:write'],
    };
    const reply = makeReply();

    await requirePermission('playlist:write')(req, reply as unknown as FastifyReply);

    // viewer normally can't write; resolved perms override allows it
    expect(reply._code).not.toBe(403);
  });

  it('denies when resolvedPerms.companyWide does not include permission', async () => {
    const req = makeReq({ sub: 'u8', cid: 'c1', rc: 'station_admin', tier: 'starter', pv: 1 });
    (req as unknown as { resolvedPerms: { companyWide: string[] } }).resolvedPerms = {
      companyWide: ['playlist:read'],
    };
    const reply = makeReply();

    await requirePermission('billing:write')(req, reply as unknown as FastifyReply);

    expect(reply._code).toBe(403);
  });
});
