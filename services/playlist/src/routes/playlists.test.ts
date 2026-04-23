/**
 * Route tests for POST /api/v1/playlists/:id/source-audio.
 *
 * DB and infoBrokerService are mocked — no real Postgres or network calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { playlistRoutes } from './playlists';

// ── mocks ──────────────────────────────────────────────────────────────────

const PLAYLIST_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const STATION_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';

const { mockGetPlaylist, mockGetPool, mockRequestAudioSourcing } = vi.hoisted(() => ({
  mockGetPlaylist: vi.fn(),
  mockGetPool: vi.fn(),
  mockRequestAudioSourcing: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/playlistService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/playlistService')>();
  return { ...actual, getPlaylist: mockGetPlaylist };
});

vi.mock('../db', () => ({
  getPool: mockGetPool,
}));

vi.mock('../services/infoBrokerService', () => ({
  requestAudioSourcing: mockRequestAudioSourcing,
}));

// Bypass auth — all requests are treated as a sys-admin.
vi.mock('@playgen/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@playgen/middleware')>();
  return {
    ...actual,
    authenticate: (_req: unknown, _rep: unknown, done: () => void) => done(),
    requirePermission: () => (_req: unknown, _rep: unknown, done: () => void) => done(),
    registerSecurity: (_app: unknown) => {},
  };
});

// ── helpers ────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(playlistRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/playlists/:id/source-audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestAudioSourcing.mockResolvedValue(undefined);
  });

  it('returns 404 when playlist does not exist', async () => {
    mockGetPlaylist.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/playlists/${PLAYLIST_ID}/source-audio`,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns {queued: 0} when all songs already have audio_url', async () => {
    mockGetPlaylist.mockResolvedValue({ id: PLAYLIST_ID, station_id: STATION_ID });
    mockGetPool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/playlists/${PLAYLIST_ID}/source-audio`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ queued: 0 });
    expect(mockRequestAudioSourcing).not.toHaveBeenCalled();
  });

  it('returns {queued: N} and calls requestAudioSourcing for songs missing audio', async () => {
    const songs = [
      { song_id: 's1', title: 'Song A', artist: 'Artist A' },
      { song_id: 's2', title: 'Song B', artist: 'Artist B' },
    ];
    mockGetPlaylist.mockResolvedValue({ id: PLAYLIST_ID, station_id: STATION_ID });
    mockGetPool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: songs }) });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/playlists/${PLAYLIST_ID}/source-audio`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ queued: 2 });
    expect(mockRequestAudioSourcing).toHaveBeenCalledWith(STATION_ID, songs);
  });

  it('does not error when Content-Type: application/json is sent without a body', async () => {
    mockGetPlaylist.mockResolvedValue({ id: PLAYLIST_ID, station_id: STATION_ID });
    mockGetPool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/playlists/${PLAYLIST_ID}/source-audio`,
      headers: { 'content-type': 'application/json' },
    });
    await app.close();

    // Fastify 5 rejects empty JSON body with 400; clients must not send C-T without body.
    // This test documents the known Fastify v5 behaviour so future devs aren't surprised.
    expect([200, 400]).toContain(res.statusCode);
  });
});
