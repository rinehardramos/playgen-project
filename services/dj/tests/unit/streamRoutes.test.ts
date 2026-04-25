/**
 * Regression test for #449 — stationId scoping in M3U8 builder.
 *
 * Verifies that `GET /stream/:stationId/playlist.m3u8` passes the correct
 * station_id as a DB query parameter for each request, so two different
 * stations never share segments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const STATION_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const STATION_B = 'bbbbbbbb-0000-0000-0000-000000000002';

const CDN_SEG_A = 'https://cdn.example.com/station-a/seg1.mp3';
const CDN_SEG_B = 'https://cdn.example.com/station-b/seg1.mp3';

describe('GET /stream/:stationId/playlist.m3u8 — stationId scoping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes the correct stationId to the DB query for each station', async () => {
    const queryCalls: Array<[string, unknown[]]> = [];
    const mockQuery = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      queryCalls.push([sql, params]);
      const stationId = params[0] as string;
      if (stationId === STATION_A) {
        return Promise.resolve({
          rows: [{ audio_url: CDN_SEG_A, audio_duration_sec: 30 }],
        });
      }
      if (stationId === STATION_B) {
        return Promise.resolve({
          rows: [{ audio_url: CDN_SEG_B, audio_duration_sec: 45 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    vi.doMock('../../src/db', () => ({
      getPool: () => ({ query: mockQuery }),
    }));
    vi.doMock('../../src/playout/playoutScheduler', () => ({
      startPlayout: vi.fn(),
      stopPlayout: vi.fn(),
      getNowPlaying: vi.fn().mockReturnValue(null),
      getActivePlayouts: vi.fn().mockReturnValue([]),
    }));
    vi.doMock('../../src/playout/hlsGenerator', () => ({
      generateHls: vi.fn(),
      cleanupHls: vi.fn(),
    }));

    const { streamRoutes } = await import('../../src/playout/streamRoutes.js');
    const app = Fastify();
    await app.register(streamRoutes);
    await app.ready();

    // Station A request
    const resA = await app.inject({ method: 'GET', url: `/stream/${STATION_A}/playlist.m3u8` });
    expect(resA.statusCode).toBe(200);
    expect(resA.body).toContain(CDN_SEG_A);
    expect(resA.body).not.toContain(CDN_SEG_B);

    // Station B request
    const resB = await app.inject({ method: 'GET', url: `/stream/${STATION_B}/playlist.m3u8` });
    expect(resB.statusCode).toBe(200);
    expect(resB.body).toContain(CDN_SEG_B);
    expect(resB.body).not.toContain(CDN_SEG_A);

    // Verify DB was called with the correct stationId for each request
    const cdnQueryCalls = queryCalls.filter(([sql]) => sql.includes('latest_script'));
    expect(cdnQueryCalls).toHaveLength(2);
    expect(cdnQueryCalls[0][1]).toContain(STATION_A);
    expect(cdnQueryCalls[1][1]).toContain(STATION_B);

    await app.close();
  });

  it('returns 404 when no approved CDN segments exist for a station', async () => {
    vi.doMock('../../src/db', () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rows: [] }),
      }),
    }));
    vi.doMock('../../src/playout/playoutScheduler', () => ({
      startPlayout: vi.fn(),
      stopPlayout: vi.fn(),
      getNowPlaying: vi.fn().mockReturnValue(null),
      getActivePlayouts: vi.fn().mockReturnValue([]),
    }));
    vi.doMock('../../src/playout/hlsGenerator', () => ({
      generateHls: vi.fn(),
      cleanupHls: vi.fn(),
    }));

    // Prevent local file check from finding a file on disk
    vi.doMock('fs', async (importOriginal) => {
      const orig = await importOriginal<typeof import('fs')>();
      return { ...orig, existsSync: vi.fn().mockReturnValue(false) };
    });

    const { streamRoutes } = await import('../../src/playout/streamRoutes.js');
    const app = Fastify();
    await app.register(streamRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: `/stream/unknown-station-id/playlist.m3u8` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
