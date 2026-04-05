/**
 * Integration tests — GET /api/v1/stations/:id/analytics/category-distribution
 *
 * Covers:
 *  - Auth: 401 without token
 *  - Validation: 400 on invalid date format
 *  - Happy path: returns category breakdown for a scheduled date
 *  - Tenant isolation: 403 when user does not have access to the station
 *  - Empty result: no playlist on that date → empty array
 *
 * Runs against a real PostgreSQL database; automatically skipped when
 * TEST_DATABASE_URL is not set.
 *
 * To run locally:
 *   TEST_DATABASE_URL=postgres://playgen:changeme@localhost:5432/playgen_test \
 *     pnpm --filter @playgen/analytics-service test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Apply TEST_DATABASE_URL env vars before any service code is imported so
// the module-level pool singleton picks them up on first use.
function applyTestDatabaseUrl(): void {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return;
  try {
    const url = new URL(raw);
    process.env.POSTGRES_HOST     = url.hostname;
    process.env.POSTGRES_PORT     = url.port || '5432';
    process.env.POSTGRES_DB       = url.pathname.replace(/^\//, '');
    process.env.POSTGRES_USER     = url.username;
    process.env.POSTGRES_PASSWORD = url.password;
  } catch { /* leave env vars as-is */ }
}

applyTestDatabaseUrl();

import { Pool } from 'pg';
import { buildTestApp, makeTestToken, closePool } from './helpers.js';

// ─── Fixture state ────────────────────────────────────────────────────────────

let app: FastifyInstance;
let pool: Pool;
let testCompanyId: string;
let testStationId: string;
let otherStationId: string;
let otherCompanyId: string;

const TEST_DATE = '2026-04-05';
const createdIds: { playlists: string[]; entries: string[]; songs: string[]; categories: string[] } = {
  playlists: [], entries: [], songs: [], categories: [],
};

// ─── Setup / teardown ─────────────────────────────────────────────────────────

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'GET /api/v1/stations/:id/analytics/category-distribution',
  () => {
    beforeAll(async () => {
      pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

      // ── Company + Station ─────────────────────────────────────────────────
      const co = await pool.query<{ id: string }>(
        `INSERT INTO companies (name, slug)
         VALUES ('Analytics Test Co', 'analytics-test-co-${Date.now()}')
         RETURNING id`,
      );
      testCompanyId = co.rows[0].id;

      const st = await pool.query<{ id: string }>(
        `INSERT INTO stations (company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
         VALUES ($1, 'Analytics Test Station', 'UTC', 0, 23,
                 ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN'])
         RETURNING id`,
        [testCompanyId],
      );
      testStationId = st.rows[0].id;

      // ── Second company + station (for tenant isolation) ───────────────────
      const co2 = await pool.query<{ id: string }>(
        `INSERT INTO companies (name, slug)
         VALUES ('Other Analytics Co', 'other-analytics-co-${Date.now()}')
         RETURNING id`,
      );
      otherCompanyId = co2.rows[0].id;

      const st2 = await pool.query<{ id: string }>(
        `INSERT INTO stations (company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
         VALUES ($1, 'Other Analytics Station', 'UTC', 0, 23, ARRAY['MON'])
         RETURNING id`,
        [otherCompanyId],
      );
      otherStationId = st2.rows[0].id;

      // ── Categories ────────────────────────────────────────────────────────
      const popCat = await pool.query<{ id: string }>(
        `INSERT INTO categories (station_id, code, label, rotation_weight)
         VALUES ($1, 'POP', 'Pop Music', 1.0)
         RETURNING id`,
        [testStationId],
      );
      const rnbCat = await pool.query<{ id: string }>(
        `INSERT INTO categories (station_id, code, label, rotation_weight)
         VALUES ($1, 'RNB', 'R&B', 1.0)
         RETURNING id`,
        [testStationId],
      );
      const popCatId = popCat.rows[0].id;
      const rnbCatId = rnbCat.rows[0].id;
      createdIds.categories.push(popCatId, rnbCatId);

      // ── Songs ─────────────────────────────────────────────────────────────
      const song1 = await pool.query<{ id: string }>(
        `INSERT INTO songs (company_id, station_id, category_id, title, artist)
         VALUES ($1, $2, $3, 'Pop Track', 'Artist A')
         RETURNING id`,
        [testCompanyId, testStationId, popCatId],
      );
      const song2 = await pool.query<{ id: string }>(
        `INSERT INTO songs (company_id, station_id, category_id, title, artist)
         VALUES ($1, $2, $3, 'RnB Track', 'Artist B')
         RETURNING id`,
        [testCompanyId, testStationId, rnbCatId],
      );
      const songPopId = song1.rows[0].id;
      const songRnbId = song2.rows[0].id;
      createdIds.songs.push(songPopId, songRnbId);

      // ── Playlist + entries for TEST_DATE ──────────────────────────────────
      const pl = await pool.query<{ id: string }>(
        `INSERT INTO playlists (station_id, date, status)
         VALUES ($1, $2, 'ready')
         RETURNING id`,
        [testStationId, TEST_DATE],
      );
      const playlistId = pl.rows[0].id;
      createdIds.playlists.push(playlistId);

      // 3 Pop entries + 1 RnB entry → 75% / 25%
      const e1 = await pool.query<{ id: string }>(
        `INSERT INTO playlist_entries (playlist_id, hour, position, song_id)
         VALUES ($1, 8, 1, $2) RETURNING id`,
        [playlistId, songPopId],
      );
      const e2 = await pool.query<{ id: string }>(
        `INSERT INTO playlist_entries (playlist_id, hour, position, song_id)
         VALUES ($1, 9, 1, $2) RETURNING id`,
        [playlistId, songPopId],
      );
      const e3 = await pool.query<{ id: string }>(
        `INSERT INTO playlist_entries (playlist_id, hour, position, song_id)
         VALUES ($1, 10, 1, $2) RETURNING id`,
        [playlistId, songPopId],
      );
      const e4 = await pool.query<{ id: string }>(
        `INSERT INTO playlist_entries (playlist_id, hour, position, song_id)
         VALUES ($1, 11, 1, $2) RETURNING id`,
        [playlistId, songRnbId],
      );
      createdIds.entries.push(e1.rows[0].id, e2.rows[0].id, e3.rows[0].id, e4.rows[0].id);

      app = await buildTestApp();
    });

    afterAll(async () => {
      await app?.close();
      if (pool) {
        if (createdIds.entries.length > 0) {
          await pool.query(
            `DELETE FROM playlist_entries WHERE id = ANY($1::uuid[])`,
            [createdIds.entries],
          );
        }
        if (createdIds.playlists.length > 0) {
          await pool.query(
            `DELETE FROM playlists WHERE id = ANY($1::uuid[])`,
            [createdIds.playlists],
          );
        }
        if (createdIds.songs.length > 0) {
          await pool.query(
            `DELETE FROM songs WHERE id = ANY($1::uuid[])`,
            [createdIds.songs],
          );
        }
        if (createdIds.categories.length > 0) {
          await pool.query(
            `DELETE FROM categories WHERE id = ANY($1::uuid[])`,
            [createdIds.categories],
          );
        }
        await pool.query(
          `DELETE FROM stations WHERE id = ANY($1::uuid[])`,
          [[testStationId, otherStationId]],
        );
        await pool.query(
          `DELETE FROM companies WHERE id = ANY($1::uuid[])`,
          [[testCompanyId, otherCompanyId]],
        );
        await pool.end();
      }
      await closePool();
    });

    // ─── Auth ──────────────────────────────────────────────────────────────

    it('returns 401 without a token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${testStationId}/analytics/category-distribution?date=${TEST_DATE}`,
      });
      expect(res.statusCode).toBe(401);
    });

    // ─── Validation ────────────────────────────────────────────────────────

    it('returns 400 on a bad date format', async () => {
      const token = makeTestToken({
        company_id: testCompanyId,
        station_ids: [testStationId],
        role_code: 'company_admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${testStationId}/analytics/category-distribution?date=05-04-2026`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    // ─── Tenant isolation ──────────────────────────────────────────────────

    it('returns 403 when user does not have access to the station', async () => {
      // Token scoped to testStationId only — accessing otherStationId must fail
      const token = makeTestToken({
        company_id: testCompanyId,
        station_ids: [testStationId],
        role_code: 'station_manager',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${otherStationId}/analytics/category-distribution?date=${TEST_DATE}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    // ─── Happy path ────────────────────────────────────────────────────────

    it('returns category distribution for a scheduled date', async () => {
      const token = makeTestToken({
        company_id: testCompanyId,
        station_ids: [testStationId],
        role_code: 'company_admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${testStationId}/analytics/category-distribution?date=${TEST_DATE}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Array<{
        category_code: string;
        category_label: string;
        total_plays: number;
        percentage: number;
      }>;

      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);

      const pop = body.find((r) => r.category_code === 'POP');
      const rnb = body.find((r) => r.category_code === 'RNB');

      expect(pop).toBeDefined();
      expect(pop!.total_plays).toBe(3);
      expect(pop!.percentage).toBe(75);

      expect(rnb).toBeDefined();
      expect(rnb!.total_plays).toBe(1);
      expect(rnb!.percentage).toBe(25);
    });

    it('returns an empty array when no playlist is scheduled for the date', async () => {
      const token = makeTestToken({
        company_id: testCompanyId,
        station_ids: [testStationId],
        role_code: 'company_admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${testStationId}/analytics/category-distribution?date=2000-01-01`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as unknown[];
      expect(body).toEqual([]);
    });

    // ─── Backward-compat: ?days=N still works ──────────────────────────────

    it('returns an array when querying with ?days=N (backward compat)', async () => {
      const token = makeTestToken({
        company_id: testCompanyId,
        station_ids: [testStationId],
        role_code: 'company_admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/stations/${testStationId}/analytics/category-distribution?days=7`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });
  },
);
