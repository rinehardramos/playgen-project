import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockListLogs = vi.fn();
const mockPurgeOldLogs = vi.fn();

vi.mock('../../src/services/systemLogService', () => ({
  listLogs: (...args: unknown[]) => mockListLogs(...args),
  purgeOldLogs: (...args: unknown[]) => mockPurgeOldLogs(...args),
}));

vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({})),
}));

// Mock middleware — authenticate sets req.user; requirePermission is a no-op in tests.
vi.mock('@playgen/middleware', () => ({
  authenticate: vi.fn(async (req: { headers: { authorization?: string }; user?: unknown }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    }
    req.user = {
      sub: 'user-1',
      cid: 'aaaaaaaa-0000-0000-0000-000000000001',
      rc: 'company_admin',
      tier: 'professional',
      sys: true,
    };
  }),
  requirePermission: () => vi.fn(async () => { /* no-op — sys flag bypasses */ }),
  registerSecurity: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMPANY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { systemLogRoutes } = await import('../../src/routes/systemLogs');
  app.register(systemLogRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/companies/:id/logs — route handler', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with paginated logs on happy path', async () => {
    const fakeResult = {
      data: [
        {
          id: 'log-1',
          created_at: '2026-04-06T00:00:00Z',
          level: 'info',
          category: 'dj',
          company_id: COMPANY_ID,
          station_id: null,
          user_id: null,
          message: 'Script generated',
          metadata: null,
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
    };

    mockListLogs.mockResolvedValueOnce(fakeResult);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY_ID}/logs`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].message).toBe('Script generated');
    expect(mockListLogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ company_id: COMPANY_ID }),
    );
  });

  it('returns 400 for invalid level param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY_ID}/logs?level=verbose`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('level must be one of');
    expect(mockListLogs).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid category param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY_ID}/logs?category=unknown`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('category must be one of');
    expect(mockListLogs).not.toHaveBeenCalled();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY_ID}/logs`,
      // no authorization header
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
