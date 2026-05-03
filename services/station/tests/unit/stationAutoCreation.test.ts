/**
 * Unit tests for station auto-creation defaults (#497).
 *
 * Root cause: seedDefaultStationDefaults (called fire-and-forget in createStation)
 * must create: category → template → template_slots (3/hr per broadcast window) → program.
 * If any step silently skips (ON CONFLICT returning nothing), downstream slots are
 * never seeded and generate-day produces 0 playlist entries.
 *
 * Fix (already in code): use ON CONFLICT DO UPDATE RETURNING id for template/category
 * inserts so the ID is always returned; loop over broadcast hours to insert slots.
 *
 * These tests mock the DB pool and verify the exact SQL call sequence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock ───────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

vi.mock('../../src/services/djSetupService', () => ({
  seedDefaultDjProfileForStation: vi.fn().mockResolvedValue(undefined),
}));

import { createStation } from '../../src/services/stationService';

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPANY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const STATION_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const CATEGORY_ID = 'cccccccc-0000-0000-0000-000000000003';
const TEMPLATE_ID = 'dddddddd-0000-0000-0000-000000000004';

/** Drain the Node.js microtask + macrotask queues so fire-and-forget promises complete. */
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createStation — auto-provision defaults (#497)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it('creates category, template, template_slots, and program for a fresh station', async () => {
    // 1. stations INSERT
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: STATION_ID, company_id: COMPANY_ID, name: 'Test FM', broadcast_start_hour: 6, broadcast_end_hour: 22 }],
    });
    // 2. rotation_rules INSERT
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // seedDefaultStationDefaults queries:
    // 3. category INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CATEGORY_ID }] });
    // 4. template INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEMPLATE_ID }] });
    // 5-N. template_slot INSERTs (3 per hour, 6→22 = 16 hours = 48 slots)
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await createStation({ company_id: COMPANY_ID, name: 'Test FM', broadcast_start_hour: 6, broadcast_end_hour: 22 });
    await flushAsync();

    const sqlCalls = (mockQuery.mock.calls as Array<[string, unknown[]]>).map(([sql]) => sql.trim());

    // category was inserted
    expect(sqlCalls.some((s) => s.includes('INSERT INTO categories'))).toBe(true);

    // template was inserted
    expect(sqlCalls.some((s) => s.includes('INSERT INTO templates'))).toBe(true);

    // template_slots were inserted — expect 3 slots × 16 hours = 48 rows
    const slotInserts = sqlCalls.filter((s) => s.includes('INSERT INTO template_slots'));
    const broadcastHours = 22 - 6; // 16 hours
    expect(slotInserts).toHaveLength(broadcastHours * 3);

    // program was inserted
    expect(sqlCalls.some((s) => s.includes('INSERT INTO programs'))).toBe(true);
  });

  it('handles wraparound broadcast window (e.g. 22:00 → 06:00 next day)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: STATION_ID, company_id: COMPANY_ID, name: 'Night FM', broadcast_start_hour: 22, broadcast_end_hour: 6 }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // rotation_rules
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CATEGORY_ID }] }); // category
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEMPLATE_ID }] }); // template
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await createStation({ company_id: COMPANY_ID, name: 'Night FM', broadcast_start_hour: 22, broadcast_end_hour: 6 });
    await flushAsync();

    const sqlCalls = (mockQuery.mock.calls as Array<[string, unknown[]]>).map(([sql]) => sql.trim());
    const slotInserts = sqlCalls.filter((s) => s.includes('INSERT INTO template_slots'));
    // 22→23 (2 hours) + 0→5 (6 hours) = 8 hours × 3 slots = 24 slots
    const expectedHours = (24 - 22) + 6;
    expect(slotInserts).toHaveLength(expectedHours * 3);
  });

  it('uses station broadcast hours as program start/end hours', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: STATION_ID, company_id: COMPANY_ID, name: 'Day FM', broadcast_start_hour: 8, broadcast_end_hour: 20 }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CATEGORY_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEMPLATE_ID }] });
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await createStation({ company_id: COMPANY_ID, name: 'Day FM', broadcast_start_hour: 8, broadcast_end_hour: 20 });
    await flushAsync();

    const programInsertCall = (mockQuery.mock.calls as Array<[string, unknown[]]>).find(([sql]) =>
      sql.includes('INSERT INTO programs'),
    );
    expect(programInsertCall).toBeDefined();

    // Verify the program insert params include start_hour=8 and end_hour=20
    const params = programInsertCall![1] as unknown[];
    expect(params).toContain(8);  // broadcast_start_hour
    expect(params).toContain(20); // broadcast_end_hour
  });

  it('assigns the auto-created category to template slots', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: STATION_ID, company_id: COMPANY_ID, name: 'Slot FM', broadcast_start_hour: 10, broadcast_end_hour: 11 }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CATEGORY_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: TEMPLATE_ID }] });
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await createStation({ company_id: COMPANY_ID, name: 'Slot FM', broadcast_start_hour: 10, broadcast_end_hour: 11 });
    await flushAsync();

    const slotInserts = (mockQuery.mock.calls as Array<[string, unknown[]]>).filter(([sql]) =>
      sql.includes('INSERT INTO template_slots'),
    );

    // All slot inserts should reference the created category_id
    for (const [, params] of slotInserts) {
      const paramArr = params as unknown[];
      expect(paramArr).toContain(CATEGORY_ID);
      expect(paramArr).toContain(TEMPLATE_ID);
    }
  });
});
