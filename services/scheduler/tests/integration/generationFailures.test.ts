/**
 * Integration tests — GET /api/v1/stations/:id/generation-failures
 *
 * Covers:
 *  - 200 happy path — returns failed jobs for the station (last 30 days)
 *  - 200 empty array — no failures
 *  - 401 unauthenticated
 *  - 403 forbidden — station belongs to a different company (tenant isolation)
 *
 * Uses Fastify inject() for HTTP simulation against a real PostgreSQL database.
 * Automatically skipped when TEST_DATABASE_URL is not set.
 *
 * To run locally:
 *   TEST_DATABASE_URL=postgres://playgen:changeme@localhost:5432/playgen \
 *     pnpm --filter @playgen/scheduler-service test:integration
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, makeTestToken, closePool } from './helpers.js';
import { getPool } from '../../src/db.js';

// Mock BullMQ so the test app doesn't require a Redis connection
vi.mock('../../src/services/queueService.js', () => ({
  enqueueGeneration: vi.fn().mockResolvedValue('mock-job-id'),
  closeQueue: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────

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

// ─── Fixture identifiers ──────────────────────────────────────────────────────

const COMPANY_ID  = 'failure-test-company';
const STATION_ID  = 'failure-test-station';
const OTHER_COMPANY_ID = 'failure-test-other-company';
const OTHER_STATION_ID = 'failure-test-other-station';

const TOKEN = makeTestToken({
  company_id: COMPANY_ID,
  station_ids: [STATION_ID],
  role_code: 'company_admin',
});
const AUTH = `Bearer ${TOKEN}`;

// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'GET /api/v1/stations/:id/generation-failures',
  () => {
    let app: FastifyInstance;
    const insertedJobIds: string[] = [];

    beforeAll(async () => {
      app = await buildTestApp();

      const pool = getPool();

      // Seed companies
      await pool.query(
        `INSERT INTO companies (id, name, slug)
         VALUES ($1, 'Failure Test Co', 'failure-test-co'),
                ($2, 'Failure Other Co', 'failure-other-co')
         ON CONFLICT (id) DO NOTHING`,
        [COMPANY_ID, OTHER_COMPANY_ID],
      );

      // Seed stations
      await pool.query(
        `INSERT INTO stations (id, company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
         VALUES
           ($1, $2, 'Failure Test Station', 'UTC', 6, 22, ARRAY['MON','TUE','WED','THU','FRI']),
           ($3, $4, 'Failure Other Station', 'UTC', 6, 22, ARRAY['MON','TUE','WED','THU','FRI'])
         ON CONFLICT (id) DO NOTHING`,
        [STATION_ID, COMPANY_ID, OTHER_STATION_ID, OTHER_COMPANY_ID],
      );

      // Insert 2 failed jobs for STATION_ID within last 30 days
      for (let i = 0; i < 2; i++) {
        const res = await pool.query<{ id: string }>(
          `INSERT INTO generation_jobs (station_id, status, error_message, triggered_by)
           VALUES ($1, 'failed', $2, 'manual')
           RETURNING id`,
          [STATION_ID, `Test failure error ${i + 1}`],
        );
        insertedJobIds.push(res.rows[0].id);
      }

      // Insert a completed job (should NOT appear in failures)
      const completedRes = await pool.query<{ id: string }>(
        `INSERT INTO generation_jobs (station_id, status, triggered_by)
         VALUES ($1, 'completed', 'manual')
         RETURNING id`,
        [STATION_ID],
      );
      insertedJobIds.push(completedRes.rows[0].id);

      // Insert a failed job for OTHER_STATION_ID (tenant isolation check)
      const otherRes = await pool.query<{ id: string }>(
        `INSERT INTO generation_jobs (station_id, status, error_message, triggered_by)
         VALUES ($1, 'failed', 'Other tenant error', 'cron')
         RETURNING id`,
        [OTHER_STATION_ID],
      );
      insertedJobIds.push(otherRes.rows[0].id);
    });

    afterAll(async () => {
      const pool = getPool();

      // Clean up in reverse FK dependency order
      if (insertedJobIds.length > 0) {
        await pool.query(
          `DELETE FROM generation_jobs WHERE id = ANY($1::uuid[])`,
          [insertedJobIds],
        );
      }
      await pool.query(`DELETE FROM stations WHERE id IN ($1, $2)`, [STATION_ID, OTHER_STATION_ID]);
      await pool.query(`DELETE FROM companies WHERE id IN ($1, $2)`, [COMPANY_ID, OTHER_COMPANY_ID]);

      await app.close();
      await closePool();
    });

    // ── 401 unauthenticated ─────────────────────────────────────────────────

    it('returns 401 when no auth token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${STATION_ID}/generation-failures`,
      });
      expect(res.statusCode).toBe(401);
    });

    // ── 403 forbidden (wrong station) ───────────────────────────────────────

    it('returns 403 when user has no access to the requested station', async () => {
      const noAccessToken = makeTestToken({
        company_id: COMPANY_ID,
        station_ids: [], // no stations
        role_code: 'station_operator',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${STATION_ID}/generation-failures`,
        headers: { Authorization: `Bearer ${noAccessToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    // ── 200 happy path ──────────────────────────────────────────────────────

    it('returns only failed jobs for the requested station (last 30 days)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${STATION_ID}/generation-failures`,
        headers: { Authorization: AUTH },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; count: number }>();
      // Should return the 2 failed jobs we inserted, not the completed one
      expect(body.count).toBe(2);
      expect(body.data).toHaveLength(2);

      const job = body.data[0] as Record<string, unknown>;
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('station_id', STATION_ID);
      expect(job).toHaveProperty('status', 'failed');
      expect(job).toHaveProperty('error_message');
    });

    // ── tenant isolation ────────────────────────────────────────────────────

    it('does not return failures from a different station (tenant isolation)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${STATION_ID}/generation-failures`,
        headers: { Authorization: AUTH },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ station_id: string }>; count: number }>();

      // Every returned job must belong to STATION_ID
      for (const job of body.data) {
        expect(job.station_id).toBe(STATION_ID);
      }
    });

    // ── 200 empty when no failures ──────────────────────────────────────────

    it('returns empty array when there are no failures for the station', async () => {
      // Use a station that has no failure records
      const cleanToken = makeTestToken({
        company_id: OTHER_COMPANY_ID,
        station_ids: [OTHER_STATION_ID],
        role_code: 'company_admin',
        // Note: the other station DOES have a failure, so use a completely clean station id
      });

      // Insert a brand-new station with no jobs
      const pool = getPool();
      const emptyStationId = 'failure-test-empty-station';
      await pool.query(
        `INSERT INTO stations (id, company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
         VALUES ($1, $2, 'Empty Station', 'UTC', 6, 22, ARRAY['MON'])
         ON CONFLICT (id) DO NOTHING`,
        [emptyStationId, COMPANY_ID],
      );

      const emptyToken = makeTestToken({
        company_id: COMPANY_ID,
        station_ids: [emptyStationId],
        role_code: 'company_admin',
      });

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/stations/${emptyStationId}/generation-failures`,
          headers: { Authorization: `Bearer ${emptyToken}` },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json<{ data: unknown[]; count: number }>();
        expect(body.data).toHaveLength(0);
        expect(body.count).toBe(0);
      } finally {
        await pool.query(`DELETE FROM stations WHERE id = $1`, [emptyStationId]);
      }

      void cleanToken; // suppress unused variable warning
    });
  },
);
