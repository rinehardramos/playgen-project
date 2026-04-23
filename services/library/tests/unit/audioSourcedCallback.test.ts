/**
 * Unit tests for POST /internal/songs/audio-sourced callback.
 *
 * DB is mocked — no real database required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { internalRoutes } from '../../src/routes/internal';

// ─── DB mock ─────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(internalRoutes);
  await app.ready();
  return app;
}

const STATION_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const SONG_ID    = 'cccccccc-0000-0000-0000-000000000003';
const R2_KEY     = `songs/${STATION_ID}/${SONG_ID}.mp3`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /internal/songs/audio-sourced', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    mockQuery.mockReset();
    // Default: query resolves with rowCount 1
    mockQuery.mockResolvedValue({ rowCount: 1 });
    app = await buildApp();
  });

  it('returns 200 and does NOT update DB when status is failed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/songs/audio-sourced',
      payload: {
        station_id: STATION_ID,
        status: 'failed',
        sourced: 0,
        errors: [{ song_id: SONG_ID, error: 'download failed' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 200 and does NOT update DB when status is completed but songs array is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/songs/audio-sourced',
      payload: {
        station_id: STATION_ID,
        status: 'completed',
        sourced: 0,
        songs: [],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 200 and calls DB update for each song when status is completed', async () => {
    process.env.S3_PUBLIC_URL_BASE = 'https://cdn.example.com';

    const res = await app.inject({
      method: 'POST',
      url: '/internal/songs/audio-sourced',
      payload: {
        station_id: STATION_ID,
        status: 'completed',
        sourced: 1,
        songs: [{ song_id: SONG_ID, r2_key: R2_KEY }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockQuery).toHaveBeenCalledOnce();

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE songs SET audio_url/);
    expect(params[0]).toBe(`https://cdn.example.com/${R2_KEY}`);
    expect(params[1]).toBe(SONG_ID);

    delete process.env.S3_PUBLIC_URL_BASE;
  });

  it('returns 200 and stores raw r2_key when S3_PUBLIC_URL_BASE is not set', async () => {
    delete process.env.S3_PUBLIC_URL_BASE;

    const res = await app.inject({
      method: 'POST',
      url: '/internal/songs/audio-sourced',
      payload: {
        station_id: STATION_ID,
        status: 'completed',
        sourced: 1,
        songs: [{ song_id: SONG_ID, r2_key: R2_KEY }],
      },
    });

    expect(res.statusCode).toBe(200);
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(R2_KEY);
  });

  it('returns 500 when DB update throws', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));

    const res = await app.inject({
      method: 'POST',
      url: '/internal/songs/audio-sourced',
      payload: {
        station_id: STATION_ID,
        status: 'completed',
        sourced: 1,
        songs: [{ song_id: SONG_ID, r2_key: R2_KEY }],
      },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 400 when station_id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/songs/audio-sourced',
      payload: {
        status: 'completed',
        sourced: 1,
        songs: [{ song_id: SONG_ID, r2_key: R2_KEY }],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when status is an invalid value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/songs/audio-sourced',
      payload: {
        station_id: STATION_ID,
        status: 'unknown',
        sourced: 0,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
