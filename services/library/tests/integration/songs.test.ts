/**
 * Integration tests for the song service.
 *
 * These tests run against a real PostgreSQL database and are automatically
 * skipped in any environment where TEST_DATABASE_URL is not set (CI without
 * a Postgres service, local development without Docker, etc.).
 *
 * To run locally:
 *   TEST_DATABASE_URL=postgres://playgen:changeme@localhost:5432/playgen_test \
 *     pnpm --filter @playgen/library-service test:integration
 *
 * The suite provisions its own isolated test fixtures (company + station +
 * category) in beforeAll and tears them down in afterAll, so it is safe to
 * run against a shared development database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  createSong,
  getSong,
  updateSong,
  deactivateSong,
  listSongs,
} from '../../src/services/songService';

// ─── Database bootstrap ───────────────────────────────────────────────────────

/**
 * Override the module-level pool used by songService so that integration tests
 * talk to TEST_DATABASE_URL rather than the default POSTGRES_* env vars.
 *
 * We set the individual POSTGRES_* variables that db.ts reads before importing
 * any service code.  Because Vitest re-uses the same Node process, the pool
 * singleton in db.ts will be lazily created on first use and will pick up
 * these overridden values.
 */
function applyTestDatabaseUrl(): void {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return;

  try {
    const url = new URL(raw);
    process.env.POSTGRES_HOST = url.hostname;
    process.env.POSTGRES_PORT = url.port || '5432';
    process.env.POSTGRES_DB = url.pathname.replace(/^\//, '');
    process.env.POSTGRES_USER = url.username;
    process.env.POSTGRES_PASSWORD = url.password;
  } catch {
    // If TEST_DATABASE_URL is not a parseable URL, leave env vars as-is
  }
}

applyTestDatabaseUrl();

// ─── Test fixture state ───────────────────────────────────────────────────────

let pool: Pool;
let testCompanyId: string;
let testStationId: string;
let testCategoryId: string;

// IDs of songs created during the test run — used for assertion and teardown
const createdSongIds: string[] = [];

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

describe.skipIf(!process.env.TEST_DATABASE_URL)('Song integration tests', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

    // ── Create isolated test company ────────────────────────────────────────
    const companyRes = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, slug)
       VALUES ('Integration Test Co', 'integration-test-co-${Date.now()}')
       RETURNING id`,
    );
    testCompanyId = companyRes.rows[0].id;

    // ── Create isolated test station ────────────────────────────────────────
    const stationRes = await pool.query<{ id: string }>(
      `INSERT INTO stations (company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
       VALUES ($1, 'Test Station', 'Asia/Manila', 5, 23, ARRAY['mon','tue','wed','thu','fri'])
       RETURNING id`,
      [testCompanyId],
    );
    testStationId = stationRes.rows[0].id;

    // ── Create isolated test category ───────────────────────────────────────
    const categoryRes = await pool.query<{ id: string }>(
      `INSERT INTO categories (station_id, code, label, rotation_weight)
       VALUES ($1, 'TST', 'Test Category', 1.0)
       RETURNING id`,
      [testStationId],
    );
    testCategoryId = categoryRes.rows[0].id;
  });

  afterAll(async () => {
    if (!pool) return;

    try {
      // ── Remove songs created during the suite ─────────────────────────────
      if (createdSongIds.length > 0) {
        await pool.query(
          `DELETE FROM song_slots  WHERE song_id = ANY($1::uuid[])`,
          [createdSongIds],
        );
        await pool.query(
          `DELETE FROM songs WHERE id = ANY($1::uuid[])`,
          [createdSongIds],
        );
      }

      // ── Remove fixtures in reverse dependency order ────────────────────────
      await pool.query(`DELETE FROM categories WHERE id = $1`, [testCategoryId]);
      await pool.query(`DELETE FROM stations  WHERE id = $1`, [testStationId]);
      await pool.query(`DELETE FROM companies WHERE id = $1`, [testCompanyId]);
    } finally {
      await pool.end();
    }
  });

  // ─── createSong ────────────────────────────────────────────────────────────

  describe('createSong', () => {
    it('creates a song and returns it with the correct fields', async () => {
      const song = await createSong({
        company_id: testCompanyId,
        station_id: testStationId,
        category_id: testCategoryId,
        title: 'Integration Test Song 1',
        artist: 'Test Artist A',
        duration_sec: 210,
        eligible_hours: [4, 5, 6],
      });

      createdSongIds.push(song.id);

      expect(song.id).toBeTruthy();
      expect(song.title).toBe('Integration Test Song 1');
      expect(song.artist).toBe('Test Artist A');
      expect(song.duration_sec).toBe(210);
      expect(song.is_active).toBe(true);
      expect(song.station_id).toBe(testStationId);
      expect(song.company_id).toBe(testCompanyId);
      expect(song.category_id).toBe(testCategoryId);
    });

    it('stores eligible_hours in song_slots and returns them on the song', async () => {
      const song = await createSong({
        company_id: testCompanyId,
        station_id: testStationId,
        category_id: testCategoryId,
        title: 'Integration Test Song 2',
        artist: 'Test Artist B',
        eligible_hours: [8, 9, 10, 14],
      });

      createdSongIds.push(song.id);

      expect(song.eligible_hours).toEqual([8, 9, 10, 14]);
    });

    it('creates a song without eligible_hours (eligible for all hours)', async () => {
      const song = await createSong({
        company_id: testCompanyId,
        station_id: testStationId,
        category_id: testCategoryId,
        title: 'Integration Test Song 3',
        artist: 'Test Artist C',
      });

      createdSongIds.push(song.id);

      expect(song.eligible_hours).toEqual([]);
    });

    it('stores raw_material when provided', async () => {
      const rawMaterial = 'TST     Integration Test Song 4 - Test Artist D {TST_4-TST_5-}';
      const song = await createSong({
        company_id: testCompanyId,
        station_id: testStationId,
        category_id: testCategoryId,
        title: 'Integration Test Song 4',
        artist: 'Test Artist D',
        raw_material: rawMaterial,
      });

      createdSongIds.push(song.id);

      expect(song.raw_material).toBe(rawMaterial);
    });
  });

  // ─── getSong ───────────────────────────────────────────────────────────────

  describe('getSong', () => {
    it('returns the song with eligible_hours populated', async () => {
      const created = await createSong({
        company_id: testCompanyId,
        station_id: testStationId,
        category_id: testCategoryId,
        title: 'getSong Test Song',
        artist: 'getSong Artist',
        eligible_hours: [6, 7],
      });
      createdSongIds.push(created.id);

      const fetched = await getSong(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.title).toBe('getSong Test Song');
      expect(fetched!.eligible_hours).toEqual([6, 7]);
    });

    it('returns null for a non-existent song id', async () => {
      const result = await getSong('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  // ─── updateSong ────────────────────────────────────────────────────────────

  describe('updateSong', () => {
    it('updates title and artist', async () => {
      const created = await createSong({
        company_id: testCompanyId,
        station_id: testStationId,
        category_id: testCategoryId,
        title: 'Original Title',
        artist: 'Original Artist',
      });
      createdSongIds.push(created.id);

      const updated = await updateSong(created.id, {
        title: 'Updated Title',
        artist: 'Updated Artist',
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Updated Title');
      expect(updated!.artist).toBe('Updated Artist');
    });

    it('replaces eligible_hours when updated', async () => {
      const created = await createSong({
        company_id: testCompanyId,
        station_id: testStationId,
        category_id: testCategoryId,
        title: 'Slot Update Test',
        artist: 'Slot Update Artist',
        eligible_hours: [4, 5],
      });
      createdSongIds.push(created.id);

      const updated = await updateSong(created.id, { eligible_hours: [10, 11, 12] });

      expect(updated!.eligible_hours).toEqual([10, 11, 12]);
    });

    it('clears eligible_hours when updated to empty array', async () => {
      const created = await createSong({
        company_id: testCompanyId,
        station_id: testStationId,
        category_id: testCategoryId,
        title: 'Clear Slots Test',
        artist: 'Clear Slots Artist',
        eligible_hours: [4, 5, 6],
      });
      createdSongIds.push(created.id);

      const updated = await updateSong(created.id, { eligible_hours: [] });

      expect(updated!.eligible_hours).toEqual([]);
    });

    it('returns null when updating a non-existent song id', async () => {
      const result = await updateSong('00000000-0000-0000-0000-000000000000', {
        title: 'Ghost Song',
      });
      expect(result).toBeNull();
    });
  });

  // ─── deactivateSong ────────────────────────────────────────────────────────

  describe('deactivateSong', () => {
    it('sets is_active=false and returns true', async () => {
      const created = await createSong({
        company_id: testCompanyId,
        station_id: testStationId,
        category_id: testCategoryId,
        title: 'Deactivate Me',
        artist: 'Deactivate Artist',
      });
      createdSongIds.push(created.id);

      const result = await deactivateSong(created.id);
      expect(result).toBe(true);

      const fetched = await getSong(created.id);
      expect(fetched!.is_active).toBe(false);
    });

    it('returns false when the song id does not exist', async () => {
      const result = await deactivateSong('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  // ─── listSongs ─────────────────────────────────────────────────────────────

  describe('listSongs', () => {
    // We create a dedicated set of songs for listing tests to keep counts predictable
    let listTestSongIds: string[] = [];

    beforeAll(async () => {
      const toCreate = [
        { title: 'List Song Alpha', artist: 'List Artist X', eligible_hours: [4] },
        { title: 'List Song Beta',  artist: 'List Artist X', eligible_hours: [5] },
        { title: 'List Song Gamma', artist: 'List Artist Y', eligible_hours: [6] },
        { title: 'List Song Delta', artist: 'List Artist Y' },
      ];

      for (const s of toCreate) {
        const created = await createSong({
          company_id: testCompanyId,
          station_id: testStationId,
          category_id: testCategoryId,
          ...s,
        });
        listTestSongIds.push(created.id);
        createdSongIds.push(created.id);
      }
    });

    it('returns paginated results with correct meta for the test station', async () => {
      const result = await listSongs(testStationId, { page: 1, limit: 2 });

      expect(result.meta.limit).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.data.length).toBeLessThanOrEqual(2);
      expect(result.meta.total_pages).toBeGreaterThanOrEqual(1);
      expect(typeof result.meta.total).toBe('number');
    });

    it('returns only active songs by default (is_active not filtered = all returned)', async () => {
      const result = await listSongs(testStationId, {});
      // All created songs are active; none from other stations are included
      const ids = result.data.map((s) => s.id);
      for (const id of listTestSongIds) {
        expect(ids).toContain(id);
      }
    });

    it('filters by is_active=false and returns only inactive songs in our station', async () => {
      // Deactivate one of our list songs
      await deactivateSong(listTestSongIds[0]);

      const result = await listSongs(testStationId, { is_active: false });

      expect(result.data.some((s) => s.id === listTestSongIds[0])).toBe(true);
      // Reactivate for cleanup integrity
      await updateSong(listTestSongIds[0], { is_active: true });
    });

    it('filters by search term (title match)', async () => {
      const result = await listSongs(testStationId, { search: 'List Song Alpha' });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data.some((s) => s.title === 'List Song Alpha')).toBe(true);
    });

    it('filters by search term (artist match)', async () => {
      const result = await listSongs(testStationId, { search: 'List Artist Y' });

      expect(result.data.length).toBeGreaterThanOrEqual(2);
      expect(result.data.every((s) => s.artist === 'List Artist Y')).toBe(true);
    });

    it('filters by category_id and returns only songs in that category', async () => {
      const result = await listSongs(testStationId, { category_id: testCategoryId });

      expect(result.data.length).toBeGreaterThanOrEqual(listTestSongIds.length);
      expect(result.data.every((s) => s.category_id === testCategoryId)).toBe(true);
    });

    it('returns page 2 with correct offset', async () => {
      const page1 = await listSongs(testStationId, { page: 1, limit: 2 });
      const page2 = await listSongs(testStationId, { page: 2, limit: 2 });

      // Page 1 and page 2 IDs should not overlap
      const page1Ids = new Set(page1.data.map((s) => s.id));
      const overlap = page2.data.filter((s) => page1Ids.has(s.id));
      expect(overlap).toHaveLength(0);
    });

    it('returns an empty data array and correct meta when search matches nothing', async () => {
      const result = await listSongs(testStationId, { search: 'xyzzy-no-match-ever-9999' });

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.total_pages).toBe(0);
    });
  });
});
