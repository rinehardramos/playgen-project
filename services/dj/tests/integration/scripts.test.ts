/**
 * Integration tests — DJ Scripts API
 *
 * Covers:
 *  - GET  /api/v1/dj/playlists/:playlistId/script  (get script)
 *  - POST /api/v1/dj/playlists/:playlistId/generate (trigger generation)
 *  - POST /api/v1/dj/scripts/:id/review            (approve / reject / edit)
 *
 * Uses Fastify inject() for HTTP simulation against a real PostgreSQL database.
 * Every test cleans up the rows it inserts so the suite is idempotent.
 *
 * NOTE: The /generate endpoint enqueues a BullMQ job.  We mock only
 * `enqueueDjGeneration` at the module level so the tests never require Redis.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, makeTestToken, closePool } from './helpers.js';
import { getPool } from '../../src/db.js';

// ── Mock BullMQ queue so /generate does not require a Redis connection ────────
vi.mock('../../src/queues/djQueue.js', () => ({
  enqueueDjGeneration: vi.fn().mockResolvedValue('mock-job-id-123'),
  closeQueue: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────

const COMPANY_ID = '00000000-2222-0000-0000-000000000001';
const STATION_ID = '00000000-3333-0000-0000-000000000001';
const TOKEN = makeTestToken({
  company_id: COMPANY_ID,
  station_ids: [STATION_ID],
  role_code: 'company_admin',
});
const AUTH_HEADER = `Bearer ${TOKEN}`;

/** Insert minimum fixture rows required to exercise /generate */
async function seedFixtures(): Promise<{ playlistId: string; profileId: string }> {
  const pool = getPool();

  // Ensure the company row exists (other services may own this; insert-or-ignore)
  await pool.query(
    `INSERT INTO companies (id, name, slug)
     VALUES ($1, 'Integ Test Co', 'integ-test-co-scripts')
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_ID],
  );

  // Station with DJ enabled
  await pool.query(
    `INSERT INTO stations
       (id, company_id, name, timezone, broadcast_start_hour, broadcast_end_hour,
        active_days, is_active, dj_enabled, dj_auto_approve)
     VALUES ($1, $2, 'Test Station', 'UTC', 6, 22, ARRAY['mon','tue','wed','thu','fri'],
             TRUE, TRUE, FALSE)
     ON CONFLICT (id) DO NOTHING`,
    [STATION_ID, COMPANY_ID],
  );

  // DJ profile (default)
  const profileRes = await pool.query<{ id: string }>(
    `INSERT INTO dj_profiles
       (company_id, name, personality, voice_style, llm_model, llm_temperature,
        tts_provider, tts_voice_id, is_default, is_active)
     VALUES ($1, 'Script Test DJ', 'Chill', 'smooth',
             'anthropic/claude-haiku-3', 0.7, 'openai', 'alloy', TRUE, TRUE)
     RETURNING id`,
    [COMPANY_ID],
  );
  const profileId = profileRes.rows[0].id;

  // Playlist attached to the station
  const playlistRes = await pool.query<{ id: string }>(
    `INSERT INTO playlists (station_id, date, status)
     VALUES ($1, CURRENT_DATE, 'ready')
     RETURNING id`,
    [STATION_ID],
  );
  const playlistId = playlistRes.rows[0].id;

  return { playlistId, profileId };
}

async function teardownFixtures(playlistId: string): Promise<void> {
  const pool = getPool();
  // Remove in dependency order
  await pool.query(`DELETE FROM dj_scripts  WHERE playlist_id = $1`, [playlistId]);
  await pool.query(`DELETE FROM playlists   WHERE id = $1`,          [playlistId]);
  await pool.query(`DELETE FROM dj_profiles WHERE company_id = $1`,  [COMPANY_ID]);
  await pool.query(`DELETE FROM stations    WHERE id = $1`,          [STATION_ID]);
  await pool.query(`DELETE FROM companies   WHERE id = $1`,          [COMPANY_ID]);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('DJ Scripts API', () => {
  let app: FastifyInstance;
  let playlistId: string;
  let profileId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    ({ playlistId, profileId } = await seedFixtures());
  });

  afterAll(async () => {
    await teardownFixtures(playlistId);
    await app.close();
    await closePool();
  });

  // ── Auth guard ─────────────────────────────────────────────────────────────

  it('GET /api/v1/dj/playlists/:id/script returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dj/playlists/${playlistId}/script`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/v1/dj/playlists/:id/generate returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dj/playlists/${playlistId}/generate`,
      headers: { 'content-type': 'application/json' },
      payload: { station_id: STATION_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── GET script — no script yet ─────────────────────────────────────────────

  it('GET /api/v1/dj/playlists/:id/script returns 404 when no script exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dj/playlists/${playlistId}/script`,
      headers: { authorization: AUTH_HEADER },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── POST /generate ─────────────────────────────────────────────────────────

  it('POST /generate enqueues a job and returns 202 with job_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dj/playlists/${playlistId}/generate`,
      headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
      payload: { station_id: STATION_ID, dj_profile_id: profileId },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('queued');
    expect(body.job_id).toBeDefined();
  });

  it('POST /generate returns 404 for a non-existent playlist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dj/playlists/00000000-0000-0000-0000-000000000000/generate',
      headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
      payload: { station_id: STATION_ID },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── POST /review ───────────────────────────────────────────────────────────

  describe('/review endpoint', () => {
    let scriptId: string;

    beforeAll(async () => {
      // Insert a synthetic script directly in the DB so we can test review actions
      // without running the full LLM generation pipeline.
      const pool = getPool();
      const res = await pool.query<{ id: string }>(
        `INSERT INTO dj_scripts
           (playlist_id, station_id, dj_profile_id, review_status, llm_model, total_segments)
         VALUES ($1, $2, $3, 'pending_review', 'anthropic/claude-haiku-3', 0)
         RETURNING id`,
        [playlistId, STATION_ID, profileId],
      );
      scriptId = res.rows[0].id;
    });

    afterAll(async () => {
      await getPool().query(`DELETE FROM dj_scripts WHERE id = $1`, [scriptId]);
    });

    it('POST /api/v1/dj/scripts/:id/review returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dj/scripts/${scriptId}/review`,
        headers: { 'content-type': 'application/json' },
        payload: { action: 'approve' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /review with action=approve transitions the script to approved', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dj/scripts/${scriptId}/review`,
        headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
        payload: { action: 'approve', review_notes: 'Sounds great!' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.review_status).toBe('approved');
      expect(body.reviewed_by).toBeDefined();
    });

    it('POST /review with invalid action returns 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dj/scripts/${scriptId}/review`,
        headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
        payload: { action: 'bogus-action' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /review with action=reject and no review_notes returns 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dj/scripts/${scriptId}/review`,
        headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
        payload: { action: 'reject' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /review with action=edit and no edited_segments returns 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dj/scripts/${scriptId}/review`,
        headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
        payload: { action: 'edit', edited_segments: [] },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
