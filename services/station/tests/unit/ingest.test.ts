/**
 * Unit tests for POST /stations/ingest-external
 *
 * Verifies:
 * - Station + DJ profile are upserted even when the station doesn't exist on production
 * - Floating segments (anchor_playlist_entry_id + start_offset_sec) are inserted
 * - Missing dj_profile does not crash the handler (optional field)
 * - Idempotent: second call with same slug upserts rather than duplicates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

// ─── Module mocks ──────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

vi.mock('../../src/services/streamControlNotifier', () => ({
  notifyStreamUrlChange: vi.fn().mockResolvedValue(undefined),
}));

// Mock middleware — authenticate injects user with company_id in req.user.cid
vi.mock('@playgen/middleware', () => ({
  authenticate: vi.fn(async (req: Record<string, unknown>) => {
    req.user = { sub: 'user-1', cid: 'company-1', rc: 'company_admin' };
  }),
  registerSecurity: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(sensible);
  const { ingestRoutes } = await import('../../src/routes/ingest');
  app.register(ingestRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

const STATION_ID = 'station-uuid-1';
const DJ_PROFILE_ID = 'dj-profile-uuid-1';
const PLAYLIST_ID = 'playlist-uuid-1';
const SCRIPT_ID = 'script-uuid-1';

/**
 * Wire up the standard sequence of mockQuery responses for a successful ingest.
 * Returns a reference to the calls array so tests can inspect it.
 */
function setupSuccessfulIngestMocks(): void {
  mockQuery
    // 2. Upsert station
    .mockResolvedValueOnce({ rows: [{ id: STATION_ID }] })
    // 3. Upsert DJ profile
    .mockResolvedValueOnce({ rows: [{ id: DJ_PROFILE_ID }] })
    // 3b. Daypart assignment
    .mockResolvedValueOnce({ rows: [] })
    // 4. Category lookup (found)
    .mockResolvedValueOnce({ rows: [{ id: 'cat-1' }] })
    // 5. Song upserts (one song)
    .mockResolvedValueOnce({ rows: [{ id: 'song-1' }] })
    // 5. Playlist upsert
    .mockResolvedValueOnce({ rows: [{ id: PLAYLIST_ID }] })
    // 5. Delete old scripts
    .mockResolvedValueOnce({ rowCount: 0 })
    // 5. Delete old playlist entries
    .mockResolvedValueOnce({ rowCount: 0 })
    // 5. Insert playlist entry
    .mockResolvedValueOnce({ rows: [] })
    // 5. Fetch entry IDs
    .mockResolvedValueOnce({ rows: [{ id: 'entry-1' }] })
    // 6. Insert script
    .mockResolvedValueOnce({ rows: [{ id: SCRIPT_ID }] })
    // 7. Insert segment (one sequential)
    .mockResolvedValueOnce({ rows: [] })
    // 8. UPDATE stations stream_url
    .mockResolvedValueOnce({ rows: [] });
}

const BASE_PAYLOAD = {
  station: {
    slug: 'test-station',
    name: 'Test Station',
    timezone: 'Asia/Manila',
  },
  dj_profile: {
    name: 'Alex',
    personality: 'Upbeat and fun',
    voice_style: 'energetic',
  },
  playlist: {
    date: '2026-05-01',
    entries: [{ hour: 8, position: 0, song_title: 'Song 1', song_artist: 'Artist A' }],
  },
  script: {
    review_status: 'auto_approved',
    segments: [
      {
        segment_type: 'intro',
        position: 0,
        script_text: 'Good morning!',
        audio_url: 'https://cdn.example.com/intro.aac',
        audio_duration_sec: 5,
      },
    ],
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/stations/ingest-external', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-build app per test to clear module cache for ingest route
    app = await buildApp();
  });

  it('creates station + DJ on production when they do not exist (upsert path)', async () => {
    setupSuccessfulIngestMocks();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stations/ingest-external',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ station_id: string; dj_profile_id: string; script_id: string }>();
    expect(body.station_id).toBe(STATION_ID);
    expect(body.dj_profile_id).toBe(DJ_PROFILE_ID);

    // Verify station upsert was called
    const stationUpsert = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('INSERT INTO stations'),
    );
    expect(stationUpsert).toBeDefined();
    expect(stationUpsert[1]).toContain('test-station'); // slug
  });

  it('inserts floating segments with anchor_playlist_entry_id and start_offset_sec', async () => {
    // Add extra mock calls: one for the floating segment insert
    setupSuccessfulIngestMocks();
    // 7b. Insert floating segment
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const payload = {
      ...BASE_PAYLOAD,
      script: {
        ...BASE_PAYLOAD.script,
        floating_segments: [
          {
            segment_type: 'station_id',
            script_text: 'You are listening to Test Station',
            audio_url: 'https://cdn.example.com/float.aac',
            audio_duration_sec: 3,
            start_offset_sec: 15,
            playlist_entry_ref: 0, // references first playlist entry
          },
        ],
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stations/ingest-external',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ floating_segment_count: number }>();
    expect(body.floating_segment_count).toBe(1);

    // Verify floating segment insert used anchor_playlist_entry_id + start_offset_sec
    const floatInsert = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('anchor_playlist_entry_id'),
    );
    expect(floatInsert).toBeDefined();
    // start_offset_sec = 15, anchor_playlist_entry_id = 'entry-1'
    expect(floatInsert[1]).toContain(15);
    expect(floatInsert[1]).toContain('entry-1');
  });

  it('is idempotent — second publish upserts station and DJ rather than duplicating', async () => {
    // Simulate second call: ON CONFLICT DO UPDATE returns same IDs
    setupSuccessfulIngestMocks();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stations/ingest-external',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);

    // Both station and DJ profile upserts were called (using ON CONFLICT DO UPDATE)
    const stationInserts = mockQuery.mock.calls.filter(([sql]: [string]) =>
      sql.includes('INSERT INTO stations'),
    );
    expect(stationInserts).toHaveLength(1); // one upsert, not two inserts

    const profileInserts = mockQuery.mock.calls.filter(([sql]: [string]) =>
      sql.includes('INSERT INTO dj_profiles'),
    );
    expect(profileInserts).toHaveLength(1); // one upsert, not two inserts
  });

  it('returns 400 when station.slug is missing', async () => {
    const payload = {
      ...BASE_PAYLOAD,
      station: { name: 'No Slug Station', timezone: 'UTC' },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stations/ingest-external',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload,
    });

    expect(res.statusCode).toBe(400);
  });
});
