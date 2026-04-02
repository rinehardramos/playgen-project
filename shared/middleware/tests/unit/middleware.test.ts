/**
 * Unit tests for shared/middleware/src/index.ts
 *
 * authenticate, requirePermission, requireStationAccess, and requireCompanyMatch
 * are tested by constructing minimal mock Fastify request/reply objects.
 * Real JWTs are signed with jsonwebtoken so the middleware's jwt.verify call
 * exercises the actual verification path.
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
});

function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
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

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function makeMockRequest(overrides: {
  headers?: Record<string, string | undefined>;
  user?: JwtPayload;
  params?: Record<string, string>;
}): {
  headers: Record<string, string | undefined>;
  user: JwtPayload;
  params: Record<string, string>;
} {
  return {
    headers: overrides.headers ?? {},
    user: overrides.user ?? ({} as JwtPayload),
    params: overrides.params ?? {},
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

    // jwt.verify('', secret) throws — should still result in 401
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
    const token = jwt.sign({ sub: 'user-1', company_id: 'c-1', station_ids: [], role_code: 'viewer', permissions: [] }, 'wrong-secret', { expiresIn: '1h' });
    const req = makeMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('sets req.user and does NOT call reply.code when token is valid', async () => {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: 'user-uuid-001',
      company_id: 'company-uuid-001',
      station_ids: ['station-uuid-001'],
      role_code: 'scheduler',
      permissions: ['playlist:read', 'playlist:write'],
    };
    const token = signToken(payload);
    const req = makeMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
    expect((req as unknown as { user: JwtPayload }).user.sub).toBe('user-uuid-001');
    expect((req as unknown as { user: JwtPayload }).user.company_id).toBe('company-uuid-001');
    expect((req as unknown as { user: JwtPayload }).user.permissions).toContain('playlist:read');
  });

  it('decodes all JwtPayload fields correctly from a valid token', async () => {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: 'user-uuid-002',
      company_id: 'company-uuid-002',
      station_ids: ['s-1', 's-2'],
      role_code: 'station_admin',
      permissions: ['library:read', 'library:write', 'template:read'],
    };
    const token = signToken(payload);
    const req = makeMockRequest({ headers: { authorization: `Bearer ${token}` } });
    const reply = makeMockReply();

    await authenticate(req as never, reply as never);

    const user = (req as unknown as { user: JwtPayload }).user;
    expect(user.station_ids).toEqual(['s-1', 's-2']);
    expect(user.role_code).toBe('station_admin');
  });
});

// ─── requirePermission ────────────────────────────────────────────────────────

describe('requirePermission', () => {
  function makeAuthedRequest(permissions: string[]): ReturnType<typeof makeMockRequest> {
    const token = signToken({
      sub: 'u-1',
      company_id: 'c-1',
      station_ids: [],
      role_code: 'scheduler',
      permissions,
    });
    const req = makeMockRequest({ headers: { authorization: `Bearer ${token}` } });
    // Simulate that authenticate already ran and set req.user
    (req as unknown as { user: JwtPayload }).user = jwt.verify(token, TEST_SECRET) as JwtPayload;
    return req;
  }

  it('does NOT call reply.code when user has the required permission', async () => {
    const req = makeAuthedRequest(['playlist:read', 'playlist:write']);
    const reply = makeMockReply();
    const hook = requirePermission('playlist:read');

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks the required permission', async () => {
    const req = makeAuthedRequest(['playlist:read']);
    const reply = makeMockReply();
    const hook = requirePermission('playlist:write');

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
  });

  it('returns 403 when user has an empty permissions array', async () => {
    const req = makeAuthedRequest([]);
    const reply = makeMockReply();
    const hook = requirePermission('library:write');

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('passes when user has the exact permission and nothing else', async () => {
    const req = makeAuthedRequest(['rules:write']);
    const reply = makeMockReply();
    const hook = requirePermission('rules:write');

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user is not populated (no authenticate step)', async () => {
    const req = makeMockRequest({});
    // req.user is the default empty object — no permissions array
    const reply = makeMockReply();
    const hook = requirePermission('playlist:read');

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
  });
});

// ─── requireStationAccess ─────────────────────────────────────────────────────

describe('requireStationAccess', () => {
  function makeUserReq(
    role: JwtPayload['role_code'],
    stationIds: string[],
    paramStationId: string,
  ) {
    const req = makeMockRequest({ params: { id: paramStationId } });
    (req as unknown as { user: JwtPayload }).user = {
      sub: 'u-1',
      company_id: 'c-1',
      station_ids: stationIds,
      role_code: role,
      permissions: [],
    };
    return req;
  }

  it('super_admin always passes regardless of station_id param', async () => {
    const req = makeUserReq('super_admin', [], 'any-station-id');
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('company_admin always passes regardless of station_id param', async () => {
    const req = makeUserReq('company_admin', [], 'any-station-id');
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('station_admin with matching station_id in station_ids passes', async () => {
    const req = makeUserReq('station_admin', ['station-aaa', 'station-bbb'], 'station-aaa');
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('station_admin with non-matching station_id returns 403', async () => {
    const req = makeUserReq('station_admin', ['station-aaa'], 'station-zzz');
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
  });

  it('scheduler role with non-matching station_id returns 403', async () => {
    const req = makeUserReq('scheduler', ['station-111'], 'station-999');
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('passes when no stationId param is present in route params', async () => {
    // No :id or :station_id param — middleware should early-return without error
    const req = makeMockRequest({ params: {} });
    (req as unknown as { user: JwtPayload }).user = {
      sub: 'u-1',
      company_id: 'c-1',
      station_ids: [],
      role_code: 'viewer',
      permissions: [],
    };
    const reply = makeMockReply();
    const hook = requireStationAccess();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('resolves station_id from params.station_id key (not just params.id)', async () => {
    const req = makeMockRequest({ params: { station_id: 'station-xyz' } });
    (req as unknown as { user: JwtPayload }).user = {
      sub: 'u-1',
      company_id: 'c-1',
      station_ids: ['station-xyz'],
      role_code: 'scheduler',
      permissions: [],
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
    role: JwtPayload['role_code'],
    userCompanyId: string,
    paramCompanyId: string,
    paramKey: 'company_id' | 'id' = 'company_id',
  ) {
    const req = makeMockRequest({ params: { [paramKey]: paramCompanyId } });
    (req as unknown as { user: JwtPayload }).user = {
      sub: 'u-1',
      company_id: userCompanyId,
      station_ids: [],
      role_code: role,
      permissions: [],
    };
    return req;
  }

  it('super_admin always passes', async () => {
    const req = makeCompanyReq('super_admin', 'c-1', 'c-999');
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
    (req as unknown as { user: JwtPayload }).user = {
      sub: 'u-1',
      company_id: 'c-1',
      station_ids: [],
      role_code: 'viewer',
      permissions: [],
    };
    const reply = makeMockReply();
    const hook = requireCompanyMatch();

    await hook(req as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
  });
});
