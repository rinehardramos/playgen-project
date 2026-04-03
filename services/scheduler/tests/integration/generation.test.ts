/**
 * Integration tests for the playlist generation engine.
 *
 * Runs against a real PostgreSQL database; automatically skipped when
 * TEST_DATABASE_URL is not set.
 *
 * To run locally:
 *   TEST_DATABASE_URL=postgres://playgen:changeme@localhost:5432/playgen \
 *     pnpm --filter @playgen/scheduler-service test:integration
 *
 * The suite creates fully isolated fixtures (company, station, categories,
 * songs, template + slots, rotation rules) and cleans them up after the run.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

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

// Import after env vars are set so the pool singleton uses the test DB.
import { generatePlaylist } from '../../src/services/generationEngine';

// ─── Fixture state ────────────────────────────────────────────────────────────

let pool: Pool;
let testCompanyId: string;
let testStationId: string;
let testCategoryId: string;
let testTemplateId: string;
const createdPlaylistIds: string[] = [];

// ─── Setup / teardown ─────────────────────────────────────────────────────────

describe.skipIf(!process.env.TEST_DATABASE_URL)('Playlist generation engine integration', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

    // Company
    const co = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, slug)
       VALUES ('Gen Test Co', 'gen-test-co-${Date.now()}')
       RETURNING id`,
    );
    testCompanyId = co.rows[0].id;

    // Station
    const st = await pool.query<{ id: string }>(
      `INSERT INTO stations (company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
       VALUES ($1, 'Gen Test Station', 'Asia/Manila', 0, 23,
               ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN'])
       RETURNING id`,
      [testCompanyId],
    );
    testStationId = st.rows[0].id;

    // Rotation rules (lenient defaults so all songs are eligible)
    await pool.query(
      `INSERT INTO rotation_rules (station_id, rules)
       VALUES ($1, '{"max_plays_per_day":10,"min_gap_hours":0,"max_same_artist_per_hour":4,"artist_separation_slots":0,"category_weights":{}}'::jsonb)
       ON CONFLICT (station_id) DO UPDATE SET rules = EXCLUDED.rules`,
      [testStationId],
    );

    // Category
    const cat = await pool.query<{ id: string }>(
      `INSERT INTO categories (station_id, code, label, rotation_weight)
       VALUES ($1, 'GEN', 'Generation Test', 1.0)
       RETURNING id`,
      [testStationId],
    );
    testCategoryId = cat.rows[0].id;

    // Songs (10 unique songs so the engine has enough candidates)
    for (let i = 1; i <= 10; i++) {
      const songRes = await pool.query<{ id: string }>(
        `INSERT INTO songs (company_id, station_id, category_id, title, artist)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [testCompanyId, testStationId, testCategoryId, `Gen Song ${i}`, `Artist ${i}`],
      );
      // No song_slots rows → eligible for all hours
      void songRes;
    }

    // Template (1_day, default)
    const tpl = await pool.query<{ id: string }>(
      `INSERT INTO templates (station_id, name, type, is_default)
       VALUES ($1, 'Gen Test Template', '1_day', true)
       RETURNING id`,
      [testStationId],
    );
    testTemplateId = tpl.rows[0].id;

    // Template slots: hours 0–3, positions 1–4 (16 slots total)
    for (let hour = 0; hour < 4; hour++) {
      for (let position = 1; position <= 4; position++) {
        await pool.query(
          `INSERT INTO template_slots (template_id, hour, position, required_category_id)
           VALUES ($1, $2, $3, $4)`,
          [testTemplateId, hour, position, testCategoryId],
        );
      }
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      // Remove generated playlists and related data (cascade handles entries + history)
      if (createdPlaylistIds.length > 0) {
        await pool.query(
          `DELETE FROM play_history WHERE playlist_id = ANY($1::uuid[])`,
          [createdPlaylistIds],
        );
        await pool.query(
          `DELETE FROM generation_jobs WHERE playlist_id = ANY($1::uuid[])`,
          [createdPlaylistIds],
        );
        await pool.query(
          `DELETE FROM playlist_entries WHERE playlist_id = ANY($1::uuid[])`,
          [createdPlaylistIds],
        );
        await pool.query(
          `DELETE FROM playlists WHERE id = ANY($1::uuid[])`,
          [createdPlaylistIds],
        );
      }
      // Template slots → template
      await pool.query(`DELETE FROM template_slots WHERE template_id = $1`, [testTemplateId]);
      await pool.query(`DELETE FROM templates WHERE id = $1`, [testTemplateId]);
      // Songs
      await pool.query(`DELETE FROM songs WHERE station_id = $1`, [testStationId]);
      // Category
      await pool.query(`DELETE FROM categories WHERE id = $1`, [testCategoryId]);
      // Rotation rules
      await pool.query(`DELETE FROM rotation_rules WHERE station_id = $1`, [testStationId]);
      // Station and company
      await pool.query(`DELETE FROM stations WHERE id = $1`, [testStationId]);
      await pool.query(`DELETE FROM companies WHERE id = $1`, [testCompanyId]);
    } finally {
      await pool.end();
    }
  });

  // ─── Tests ─────────────────────────────────────────────────────────────────

  it('generates a playlist with the correct number of entries', async () => {
    const date = '2099-01-01'; // far-future date to avoid conflicts
    const result = await generatePlaylist({
      stationId: testStationId,
      date,
      templateId: testTemplateId,
      triggeredBy: 'manual',
    });

    createdPlaylistIds.push(result.playlistId);

    // 4 hours × 4 positions = 16 expected entries
    expect(result.playlistId).toBeTruthy();
    expect(result.entriesCount).toBe(16);
  });

  it('leaves playlist in ready status after successful generation', async () => {
    const [playlistId] = createdPlaylistIds;
    const res = await pool.query<{ status: string }>(
      'SELECT status FROM playlists WHERE id = $1',
      [playlistId],
    );
    expect(res.rows[0].status).toBe('ready');
  });

  it('creates play_history rows for each generated entry', async () => {
    const [playlistId] = createdPlaylistIds;
    const res = await pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM play_history WHERE playlist_id = $1',
      [playlistId],
    );
    expect(Number(res.rows[0].count)).toBe(16);
  });

  it('marks the generation_job as completed', async () => {
    const [playlistId] = createdPlaylistIds;
    const res = await pool.query<{ status: string }>(
      'SELECT status FROM generation_jobs WHERE playlist_id = $1 ORDER BY queued_at DESC LIMIT 1',
      [playlistId],
    );
    expect(res.rows[0].status).toBe('completed');
  });

  it('assigns songs only from the required category', async () => {
    const [playlistId] = createdPlaylistIds;
    const res = await pool.query<{ category_id: string }>(
      `SELECT DISTINCT s.category_id
       FROM playlist_entries pe
       JOIN songs s ON s.id = pe.song_id
       WHERE pe.playlist_id = $1`,
      [playlistId],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].category_id).toBe(testCategoryId);
  });

  it('uses the default template when no templateId is provided', async () => {
    const date = '2099-01-02';
    const result = await generatePlaylist({
      stationId: testStationId,
      date,
      triggeredBy: 'manual',
    });
    createdPlaylistIds.push(result.playlistId);
    expect(result.entriesCount).toBe(16);
  });

  it('throws when the playlist is already approved', async () => {
    // Approve the first playlist
    const [playlistId] = createdPlaylistIds;
    await pool.query(`UPDATE playlists SET status = 'approved' WHERE id = $1`, [playlistId]);

    await expect(
      generatePlaylist({
        stationId: testStationId,
        date: '2099-01-01',
        triggeredBy: 'manual',
      }),
    ).rejects.toThrow('already approved');

    // Restore to ready so afterAll cleanup works cleanly
    await pool.query(`UPDATE playlists SET status = 'ready' WHERE id = $1`, [playlistId]);
  });

  it('preserves manual overrides on re-generation', async () => {
    // Use the second playlist (2099-01-02, not approved)
    const playlistId = createdPlaylistIds[1];

    // Find one entry and mark it as a manual override
    const entryRes = await pool.query<{ hour: number; position: number; song_id: string }>(
      `SELECT hour, position, song_id FROM playlist_entries WHERE playlist_id = $1 LIMIT 1`,
      [playlistId],
    );
    const override = entryRes.rows[0];
    await pool.query(
      `UPDATE playlist_entries SET is_manual_override = true WHERE playlist_id = $1 AND hour = $2 AND position = $3`,
      [playlistId, override.hour, override.position],
    );

    // Re-generate
    await generatePlaylist({
      stationId: testStationId,
      date: '2099-01-02',
      triggeredBy: 'manual',
    });

    // The override entry should still point to the same song
    const afterRes = await pool.query<{ song_id: string; is_manual_override: boolean }>(
      `SELECT song_id, is_manual_override FROM playlist_entries
       WHERE playlist_id = $1 AND hour = $2 AND position = $3`,
      [playlistId, override.hour, override.position],
    );
    expect(afterRes.rows[0].song_id).toBe(override.song_id);
    expect(afterRes.rows[0].is_manual_override).toBe(true);
  });
});
