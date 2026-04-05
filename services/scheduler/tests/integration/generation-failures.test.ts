/**
 * Integration tests — GET /api/v1/stations/:id/generation-failures
 *
 * Covers:
 *  - Auth: 401 without token, 403 for wrong station
 *  - Happy path: returns only failed jobs within the last 30 days
 *  - Tenant isolation: user from another company cannot access failures
 *
 * Runs against a real PostgreSQL database; automatically skipped when
 * TEST_DATABASE_URL is not set.
 *
 * To run locally:
 *   TEST_DATABASE_URL=postgres://playgen:changeme@localhost:5432/playgen \
 *     pnpm --filter @playgen/scheduler-service test:integration
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Apply TEST_DATABASE_URL env vars before any service code is imported so
// the module-level pool singleton picks them up on first use.
function applyTestDatabaseUrl(): void {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return;
  try {
    const url = new URL(raw);
    process.env.POSTGRES_HOST = url.hostname;
    process.env.POSTGRES_PORT = url.port || '5432';
    process.env.POSTGRES_DB   = url.pathname.replace(/^\//, '');
    process.env.POSTGRES_USER = url.username;
    process.env.POSTGRES_PASSWORD = url.password;
  } catch { /* leave env vars as-is */ }
}

applyTestDatabaseUrl();

// Mock BullMQ so the routes file can be imported without a Redis connection
vi.mock('../../src/services/queueService.js', () => ({
  enqueueGeneration: vi.fn().mockResolvedValue('mock-job-id'),
  getJobStatus: vi.fn().mockResolvedValue(null),
  closeQueue: vi.fn().mockResolvedValue(undefined),
}));

import { Pool } from 'pg';
import { buildTestApp, makeTestToken, closePool } from './helpers.js';
import { getPool } from '../../src/db.js';

// ─── Fixture state ────────────────────────────────────────────────────────────

let app: FastifyInstance;
let pool: Pool;
let testCompanyId: string;
let testStationId: string;
let otherStationId: string;
const createdJobIds: string[] = [];

const AUTH = `Bearer ${makeTestToken({ company_id: undefined, station_ids: undefined, role_code: 'company_admin' })}`;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/v1/stations/:id/generation-failures', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

    // Company
    const co = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, slug)
       VALUES ('Failures Test Co', 'failures-test-co-${Date.now()}')
       RETURNING id`,
    );
    testCompanyId = co.rows[0].id;

    // Station
    const st = await pool.query<{ id: string }>(
      `INSERT INTO stations (company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
       VALUES ($1, 'Failures Test Station', 'UTC', 0, 23,
               ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN'])
       RETURNING id`,
      [testCompanyId],
    );
    testStationId = st.rows[0].id;

    // Another station belonging to a different company (for tenant isolation test)
    const co2 = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, slug)
       VALUES ('Other Co', 'other-co-${Date.now()}')
       RETURNING id`,
    );
    const st2 = await pool.query<{ id: string }>(
      `INSERT INTO stations (company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
       VALUES ($1, 'Other Station', 'UTC', 0, 23, ARRAY['MON'])
       RETURNING id`,
      [co2.rows[0].id],
    );
    otherStationId = st2.rows[0].id;

    // Seed generation_jobs: 2 failed (recent), 1 failed (>30 days old), 1 completed
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const old    = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(); // 35 days ago

    const j1 = await pool.query<{ id: string }>(
      `INSERT INTO generation_jobs (station_id, status, error_message, queued_at, triggered_by)
       VALUES ($1, 'failed', 'LLM timeout', $2, 'cron')
       RETURNING id`,
      [testStationId, recent],
    );
    const j2 = await pool.query<{ id: string }>(
      `INSERT INTO generation_jobs (station_id, status, error_message, queued_at, triggered_by)
       VALUES ($1, 'failed', 'No template found', $2, 'manual')
       RETURNING id`,
      [testStationId, recent],
    );
    const j3 = await pool.query<{ id: string }>(
      `INSERT INTO generation_jobs (station_id, status, error_message, queued_at, triggered_by)
       VALUES ($1, 'failed', 'Old failure', $2, 'cron')
       RETURNING id`,
      [testStationId, old],
    );
    const j4 = await pool.query<{ id: string }>(
      `INSERT INTO generation_jobs (station_id, status, queued_at, triggered_by)
       VALUES ($1, 'completed', $2, 'manual')
       RETURNING id`,
      [testStationId, recent],
    );
    createdJobIds.push(j1.rows[0].id, j2.rows[0].id, j3.rows[0].id, j4.rows[0].id);

    // Override pool env so service's getPool() uses the test DB
    process.env.POSTGRES_HOST = new URL(process.env.TEST_DATABASE_URL!).hostname;

    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
    if (pool) {
      if (createdJobIds.length > 0) {
        await pool.query(
          `DELETE FROM generation_jobs WHERE id = ANY($1::uuid[])`,
          [createdJobIds],
        );
      }
      await pool.query(`DELETE FROM stations WHERE id = ANY($1::uuid[])`, [[testStationId, otherStationId]]);
      await pool.query(`DELETE FROM companies WHERE id = $1`, [testCompanyId]);
      await pool.end();
    }
    await closePool();
  });

  // ─── Auth tests ──────────────────────────────────────────────────────────

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stations/${testStationId}/generation-failures`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for a non-UUID station id', async () => {
    const token = makeTestToken({ station_ids: ['not-a-uuid'] });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stations/not-a-uuid/generation-failures`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── Tenant isolation ────────────────────────────────────────────────────

  it('returns 403 when the user does not have access to the station', async () => {
    // Token has access to testStationId only, not otherStationId
    const token = makeTestToken({
      company_id: testCompanyId,
      station_ids: [testStationId],
      role_code: 'station_manager',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stations/${otherStationId}/generation-failures`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it('returns only failed jobs from the last 30 days', async () => {
    const token = makeTestToken({
      company_id: testCompanyId,
      station_ids: [testStationId],
      role_code: 'company_admin',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stations/${testStationId}/generation-failures`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[]; count: number };
    // Should return exactly 2 — the recent failures; old failure and completed are excluded
    expect(body.data).toHaveLength(2);
    expect(body.count).toBe(2);
  });

  it('returns failures ordered by queued_at DESC', async () => {
    const token = makeTestToken({
      company_id: testCompanyId,
      station_ids: [testStationId],
      role_code: 'company_admin',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stations/${testStationId}/generation-failures`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body) as { data: Array<{ queued_at: string }> };
    const dates = body.data.map((f) => new Date(f.queued_at).getTime());
    expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
  });

  it('includes error_message and triggered_by in each row', async () => {
    const token = makeTestToken({
      company_id: testCompanyId,
      station_ids: [testStationId],
      role_code: 'company_admin',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stations/${testStationId}/generation-failures`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body) as { data: Array<Record<string, unknown>> };
    for (const row of body.data) {
      expect(row).toHaveProperty('error_message');
      expect(row).toHaveProperty('triggered_by');
      expect(row).toHaveProperty('queued_at');
      expect(row.status).toBe('failed');
    }
  });

  it('returns empty data when no failures exist for the station', async () => {
    // Use a brand-new station with no jobs
    const newStation = await pool.query<{ id: string }>(
      `INSERT INTO stations (company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
       VALUES ($1, 'Empty Station', 'UTC', 0, 23, ARRAY['MON'])
       RETURNING id`,
      [testCompanyId],
    );
    const stationId = newStation.rows[0].id;

    try {
      const token = makeTestToken({
        company_id: testCompanyId,
        station_ids: [stationId],
        role_code: 'company_admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${stationId}/generation-failures`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { data: unknown[]; count: number };
      expect(body.data).toHaveLength(0);
    } finally {
      await pool.query(`DELETE FROM stations WHERE id = $1`, [stationId]);
    }
  });
});
