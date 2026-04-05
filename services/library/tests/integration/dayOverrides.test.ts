/**
 * Integration tests for template day-of-week overrides.
 *
 * Runs against a real PostgreSQL database, skipped unless TEST_DATABASE_URL is set.
 *
 * To run locally:
 *   TEST_DATABASE_URL=postgres://playgen:changeme@localhost:5432/playgen_test \
 *     pnpm --filter @playgen/library-service test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  createTemplate,
  getDayOverrides,
  setDayOverrides,
} from '../../src/services/templateService';

// ─── Database bootstrap ────────────────────────────────────────────────────────

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
    // leave as-is
  }
}

applyTestDatabaseUrl();

// ─── Test fixture state ────────────────────────────────────────────────────────

let pool: Pool;
let testCompanyId: string;
let testStationId: string;
let templateId: string;
let altTemplateId: string;

// ─── Setup / Teardown ──────────────────────────────────────────────────────────

describe.skipIf(!process.env.TEST_DATABASE_URL)('Day-of-week overrides integration tests', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

    const companyRes = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, slug)
       VALUES ('DOW Override Test Co', 'dow-override-test-co-${Date.now()}')
       RETURNING id`,
    );
    testCompanyId = companyRes.rows[0].id;

    const stationRes = await pool.query<{ id: string }>(
      `INSERT INTO stations (company_id, name, slug, timezone)
       VALUES ($1, 'DOW Test Station', 'dow-test-station-${Date.now()}', 'UTC')
       RETURNING id`,
      [testCompanyId],
    );
    testStationId = stationRes.rows[0].id;

    const tpl = await createTemplate({ station_id: testStationId, name: 'Base Template', type: '1_day' });
    templateId = tpl.id;
    const alt = await createTemplate({ station_id: testStationId, name: 'Alt Template', type: '1_day' });
    altTemplateId = alt.id;
  });

  afterAll(async () => {
    // Templates cascade on station delete; deleting company cascades everything
    await pool.query('DELETE FROM companies WHERE id = $1', [testCompanyId]);
    await pool.end();
  });

  // ─── Happy path ─────────────────────────────────────────────────────────────

  it('getDayOverrides returns all-null map for a fresh template', async () => {
    const overrides = await getDayOverrides(templateId);
    expect(overrides).not.toBeNull();
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const day of days) {
      expect((overrides as Record<string, unknown>)[day]).toBeNull();
    }
  });

  it('setDayOverrides persists specific day overrides', async () => {
    const updated = await setDayOverrides(templateId, {
      monday: altTemplateId,
      friday: altTemplateId,
    });
    expect(updated).not.toBeNull();
    expect(updated!.monday).toBe(altTemplateId);
    expect(updated!.friday).toBe(altTemplateId);
    expect(updated!.tuesday).toBeNull();
    expect(updated!.saturday).toBeNull();
  });

  it('getDayOverrides reflects persisted values', async () => {
    const overrides = await getDayOverrides(templateId);
    expect(overrides!.monday).toBe(altTemplateId);
    expect(overrides!.friday).toBe(altTemplateId);
    expect(overrides!.wednesday).toBeNull();
  });

  it('setDayOverrides with null clears a day override', async () => {
    const updated = await setDayOverrides(templateId, { monday: null });
    expect(updated!.monday).toBeNull();
    // friday override should still be set
    expect(updated!.friday).toBe(altTemplateId);
  });

  // ─── Not-found / tenant isolation ───────────────────────────────────────────

  it('getDayOverrides returns null for non-existent template', async () => {
    const result = await getDayOverrides('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('setDayOverrides returns null for non-existent template', async () => {
    const result = await setDayOverrides('00000000-0000-0000-0000-000000000000', { monday: altTemplateId });
    expect(result).toBeNull();
  });

  it('tenant isolation: overrides on one template do not affect another', async () => {
    const altOverrides = await getDayOverrides(altTemplateId);
    // altTemplate was never updated, should be all-null
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const day of days) {
      expect((altOverrides as Record<string, unknown>)[day]).toBeNull();
    }
  });
});
