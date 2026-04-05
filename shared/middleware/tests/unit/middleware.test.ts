/**
 * Unit tests for shared/middleware/src/index.ts
 *
 * authenticate, requirePermission, requireStationAccess, and requireCompanyMatch
 * are tested by constructing minimal mock Fastify request/reply objects.
 * Real JWTs are signed with jsonwebtoken so the middleware's jwt.verify call
 * exercises the actual verification path.
 *
 * Updated for thin JWT format: sub, cid, rc, tier, pv, sys?
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  authenticate,
  requirePermission,
  requireStationAccess,
  requireCompanyMatch,
} from '../../src/index';
import type { JwtPayload } from '@playgen/types';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const TEST_SECRET = 'dev-access-secret-change-in-prod';

// Ensure the middleware reads the same secret we sign with
beforeEach(() => {
  delete process.env.JWT_ACCESS_SECRET;
  vi.clearAllMocks();
});

type ThinPayload = {
  sub: string;
  cid: string;
  rc: string;
  tier: 'free' | 'starter' | 'professional' | 'enterprise';
  pv: number;
  sys?: true;
};

function signToken(payload: ThinPayload): string {
  return jwt.sign(payload as object, TEST_SECRET, { expiresIn: '15m' });
}

// ─── Mock factories ───────────────────────────────────────────────────────────

type MockReply = {
  code: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  _sentCode: number | null;
  _sentBody: unknown;
};

function makeMockReply(): MockReply {
  const reply: MockReply = {
    _sentCode: null,
    _sentBody: undefined,
    code: vi.fn(),
    send: vi.fn(),
  };

  // chain: reply.code(401).send(body)
  reply.code.mockImplementation((statusCode: number) => {
    reply._sentCode = statusCode;
    return reply; // return self so .send() can be called
  });
  reply.send.mockImplementation((body: unknown) => {
    reply._sentBody = body;
    return reply;
  });

  return reply;
}

function makeMockRequest(overrides: {
  headers?: Record<string, string | undefined>;
  user?: Partial<JwtPayload>;
  params?: Record<string, string>;
  server?: Record<string, unknown>;
  resolvedPerms?: { companyWide: string[]; accessibleStationIds: string[] };
}) {
  return {
    headers: overrides.headers ?? {},
    user: overrides.user ?? ({} as JwtPayload),
    params: overrides.params ?? {},
    server: overrides.server ?? {},
    resolvedPerms: overrides.resolvedPerms,
  };
}

// ─── authenticate ─────────────────────────────────────────────────────────────

describe('authenticate', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const req = makeMockRequest({ headers: {} });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'UNAUTHORIZED' }) }),
    );
  });

  it('returns 401 when Authorization header does not start with "Bearer "', async () => {
    const req = makeMockRequest({ headers: { authorization: 'Token abc123' } });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('returns 401 when Authorization header is "Bearer " with no token', async () => {
    const req = makeMockRequest({ headers: { authorization: 'Bearer ' } });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('returns 401 for a syntactically invalid (garbage) token', async () => {
    const req = makeMockRequest({ headers: { authorization: 'Bearer not.a.valid.jwt' } });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'UNAUTHORIZED' }) }),
    );
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const token = jwt.sign({ sub: 'user-1', cid: 'c-1', rc: 'viewer', tier: 'free', pv: 1 }, 'wrong-secret', { expiresIn: '1h' });
    const req = makeMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('sets req.user and does NOT call reply.code when token is valid', async () => {
    const payload: ThinPayload = {
      sub: 'user-uuid-001',
      cid: 'company-uuid-001',
      rc: 'scheduler',
      tier: 'free',
      pv: 1,
    };
    const token = signToken(payload);
    const req = makeMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
    const user = (req as unknown as { user: ThinPayload }).user;
    expect(user.sub).toBe('user-uuid-001');
    expect(user.cid).toBe('company-uuid-001');
    expect(user.rc).toBe('scheduler');
  });

  it('decodes all thin JWT fields correctly from a valid token', async () => {
    const payload: ThinPayload = {
      sub: 'user-uuid-002',
      cid: 'company-uuid-002',
      rc: 'station_admin',
      tier: 'professional',
      pv: 3,
    };
    const token = signToken(payload);
    const req = makeMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    const user = (req as unknown as { user: ThinPayload }).user;
    expect(user.tier).toBe('professional');
    expect(user.rc).toBe('station_admin');
    expect(user.pv).toBe(3);
  });
});

// ─── requirePermission ────────────────────────────────────────────────────────

describe('requirePermission', () => {
  function makeAuthedRequest(roleCode: string, sys?: true): ReturnType<typeof makeMockRequest> {
    const req = makeMockRequest({});
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1',
      cid: 'c-1',
      rc: roleCode,
      tier: 'free',
      pv: 1,
      ...(sys ? { sys } : {}),
    };
    return req;
  }

  it('does NOT call reply.code when user has the required permission (station_admin → playlist:read)', async () => {
    const req = makeAuthedRequest('station_admin');
    const reply = makeMockReply();
    const hook = requirePermission('playlist:read');

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks the required permission (viewer → playlist:write)', async () => {
    const req = makeAuthedRequest('viewer');
    const reply = makeMockReply();
    const hook = requirePermission('playlist:write');

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
  });

  it('returns 403 when user has an unknown role code', async () => {
    const req = makeAuthedRequest('unknown_role');
    const reply = makeMockReply();
    const hook = requirePermission('library:write');

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('passes when user has the exact permission and nothing else (scheduler → playlist:read)', async () => {
    const req = makeAuthedRequest('scheduler');
    const reply = makeMockReply();
    const hook = requirePermission('playlist:read');

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('sys=true bypasses permission check entirely', async () => {
    const req = makeAuthedRequest('company_admin', true);
    const reply = makeMockReply();
    const hook = requirePermission('billing:write');

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user is not populated (no authenticate step)', async () => {
    const req = makeMockRequest({});
    const reply = makeMockReply();
    const hook = requirePermission('playlist:read');

    await hook(req as never, reply as never);

    // Empty user object has no rc field → ROLE_PERMISSIONS[undefined] = [] → 403
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('uses resolvedPerms.companyWide when present', async () => {
    const req = makeMockRequest({
      resolvedPerms: { companyWide: ['dj:write'], accessibleStationIds: [] },
    });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1', cid: 'c-1', rc: 'viewer', tier: 'free', pv: 1,
    };
    const reply = makeMockReply();
    const hook = requirePermission('dj:write');

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 403 when resolvedPerms.companyWide does not include permission', async () => {
    const req = makeMockRequest({
      resolvedPerms: { companyWide: ['library:read'], accessibleStationIds: [] },
    });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1', cid: 'c-1', rc: 'company_admin', tier: 'free', pv: 1,
      // Note: no sys flag — so resolvedPerms path is used
    };
    const reply = makeMockReply();
    const hook = requirePermission('billing:write');

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
  });
});

// ─── requireStationAccess ─────────────────────────────────────────────────────

describe('requireStationAccess', () => {
  it('sys=true (super_admin) always passes regardless of station_id param', async () => {
    const req = makeMockRequest({ params: { id: 'any-station-id' } });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1', cid: 'c-1', rc: 'super_admin', tier: 'enterprise', pv: 1, sys: true,
    };
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('sys=true (company_admin) always passes regardless of station_id param', async () => {
    const req = makeMockRequest({ params: { id: 'any-station-id' } });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1', cid: 'c-1', rc: 'company_admin', tier: 'starter', pv: 1, sys: true,
    };
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('passes when resolvedPerms includes the station', async () => {
    const req = makeMockRequest({
      params: { id: 'station-aaa' },
      resolvedPerms: { companyWide: [], accessibleStationIds: ['station-aaa', 'station-bbb'] },
    });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1', cid: 'c-1', rc: 'station_admin', tier: 'free', pv: 1,
    };
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 403 when resolvedPerms does not include the station', async () => {
    const req = makeMockRequest({
      params: { id: 'station-zzz' },
      resolvedPerms: { companyWide: [], accessibleStationIds: ['station-aaa'] },
    });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1', cid: 'c-1', rc: 'station_admin', tier: 'free', pv: 1,
    };
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
  });

  it('passes when no stationId param is present in route params', async () => {
    const req = makeMockRequest({ params: {} });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1', cid: 'c-1', rc: 'viewer', tier: 'free', pv: 1,
    };
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('resolves station_id from params.station_id key (not just params.id)', async () => {
    const req = makeMockRequest({
      params: { station_id: 'station-xyz' },
      resolvedPerms: { companyWide: [], accessibleStationIds: ['station-xyz'] },
    });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1', cid: 'c-1', rc: 'scheduler', tier: 'free', pv: 1,
    };
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });
});

// ─── requireCompanyMatch ──────────────────────────────────────────────────────

describe('requireCompanyMatch', () => {
  function makeCompanyReq(
    rc: string,
    userCompanyId: string,
    paramCompanyId: string,
    paramKey: 'company_id' | 'id' = 'company_id',
    sys?: true,
  ) {
    const req = makeMockRequest({ params: { [paramKey]: paramCompanyId } });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1',
      cid: userCompanyId,
      rc,
      tier: 'free',
      pv: 1,
      ...(sys ? { sys } : {}),
    };
    return req;
  }

  it('sys=true always passes regardless of company param', async () => {
    const req = makeCompanyReq('super_admin', 'c-1', 'c-999', 'company_id', true);
    const reply = makeMockReply();
    const hook = requireCompanyMatch();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('company_admin with matching company_id passes', async () => {
    const req = makeCompanyReq('company_admin', 'c-abc', 'c-abc');
    const reply = makeMockReply();
    const hook = requireCompanyMatch();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('company_admin with wrong company_id returns 403', async () => {
    const req = makeCompanyReq('company_admin', 'c-abc', 'c-xyz');
    const reply = makeMockReply();
    const hook = requireCompanyMatch();

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
  });

  it('resolves company id from params.id key when params.company_id is absent', async () => {
    const req = makeCompanyReq('station_admin', 'c-123', 'c-123', 'id');
    const reply = makeMockReply();
    const hook = requireCompanyMatch();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('passes when no company param is present', async () => {
    const req = makeMockRequest({ params: {} });
    (req as unknown as { user: ThinPayload }).user = {
      sub: 'u-1', cid: 'c-1', rc: 'viewer', tier: 'free', pv: 1,
    };
    const reply = makeMockReply();
    const hook = requireCompanyMatch();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });
});
