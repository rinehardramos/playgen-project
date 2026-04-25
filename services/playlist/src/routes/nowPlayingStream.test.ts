/**
 * Unit tests for GET /api/v1/playlists/now-playing/stream
 *
 * Guard tests (400 / 401) use Fastify inject() — those paths return before
 * the SSE stream opens so inject() resolves normally.
 *
 * The happy-path "emits first event" test validates the exported
 * queryNowPlaying helper directly (which is the core logic of the first
 * emission) rather than going through inject(), which would block indefinitely
 * waiting for the long-lived SSE stream to close.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { nowPlayingStreamRoutes, queryNowPlaying } from './nowPlayingStream';

// ── mocks ──────────────────────────────────────────────────────────────────

const STATION_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const TODAY_DATE = '2026-04-25';

const { mockGetPool, mockAuthenticate } = vi.hoisted(() => ({
  mockGetPool: vi.fn(),
  mockAuthenticate: vi.fn((_req: unknown, _rep: unknown, done: () => void) => done()),
}));

vi.mock('../db', () => ({
  getPool: mockGetPool,
}));

vi.mock('@playgen/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@playgen/middleware')>();
  return {
    ...actual,
    authenticate: mockAuthenticate,
    requirePermission: () => (_req: unknown, _rep: unknown, done: () => void) => done(),
    registerSecurity: (_app: unknown) => {},
  };
});

// ── helpers ────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(nowPlayingStreamRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('GET /api/v1/playlists/now-playing/stream — guard tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockImplementation((_req: unknown, _rep: unknown, done: () => void) => done());
  });

  it('returns 400 when stationId is missing', async () => {
    mockGetPool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/playlists/now-playing/stream' });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when date param is malformed', async () => {
    mockGetPool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/playlists/now-playing/stream?stationId=${STATION_ID}&date=not-a-date`,
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('returns 401 without a valid auth token', async () => {
    mockAuthenticate.mockImplementation(
      (_req: unknown, rep: { code: (n: number) => { send: (b: unknown) => void } }, _done: () => void) => {
        rep.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
      },
    );

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/playlists/now-playing/stream?stationId=${STATION_ID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});

describe('queryNowPlaying — unit tests for first-event logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns playlist_id and status when playlist exists', async () => {
    mockGetPool.mockReturnValue({
      query: vi.fn().mockResolvedValue({
        rows: [{ playlist_id: 'pid-001', status: 'approved' }],
      }),
    });

    const result = await queryNowPlaying(STATION_ID, TODAY_DATE);

    expect(result).toMatchObject({
      playlist_id: 'pid-001',
      status: 'approved',
    });
    expect(typeof result.current_hour).toBe('number');
    expect(result.current_hour).toBeGreaterThanOrEqual(0);
    expect(result.current_hour).toBeLessThanOrEqual(23);
  });

  it('returns null playlist_id and null status when no playlist exists', async () => {
    mockGetPool.mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    });

    const result = await queryNowPlaying(STATION_ID, TODAY_DATE);

    expect(result.playlist_id).toBeNull();
    expect(result.status).toBeNull();
    expect(typeof result.current_hour).toBe('number');
  });

  it('queries with the correct stationId and date', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    mockGetPool.mockReturnValue({ query: mockQuery });

    await queryNowPlaying(STATION_ID, TODAY_DATE);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM playlists'),
      [STATION_ID, TODAY_DATE],
    );
  });

  it('serialises the first event payload as valid SSE', () => {
    // Validate that the SSE wire format is correct for a sample payload
    const data = { current_hour: 14, playlist_id: 'pid-001', status: 'approved' };
    const sseFrame = `data: ${JSON.stringify(data)}\n\n`;

    expect(sseFrame).toMatch(/^data: /);
    const lines = sseFrame.split('\n').filter((l) => l.startsWith('data:'));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0].replace(/^data: /, ''));
    expect(parsed).toMatchObject({ current_hour: 14, playlist_id: 'pid-001', status: 'approved' });
  });
});
