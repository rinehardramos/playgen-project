import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB module before importing the service under test
const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

import { seedDefaultDjProfileForStation } from '../../src/services/djSetupService';

const COMPANY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const STATION_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const PROFILE_ID = 'cccccccc-0000-0000-0000-000000000001';

// 11 segment types seeded as default templates
const TEMPLATE_COUNT = 11;

beforeEach(() => {
  mockQuery.mockReset();
});

describe('seedDefaultDjProfileForStation', () => {
  it('skips gracefully when dj_profiles table does not exist', async () => {
    // Table existence check returns false
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });

    await seedDefaultDjProfileForStation(COMPANY_ID, STATION_ID);

    // Only one query should have been made (the table existence check)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('reuses existing default profile and seeds daypart assignments', async () => {
    // 1. dj_profiles table exists
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
    // 2. Existing default profile found
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: PROFILE_ID }] });
    // 3-7. Five daypart inserts (ON CONFLICT DO NOTHING)
    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    }
    // 8. dj_script_templates table exists
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
    // 9-(8+TEMPLATE_COUNT). Template inserts
    for (let i = 0; i < TEMPLATE_COUNT; i++) {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    }

    await seedDefaultDjProfileForStation(COMPANY_ID, STATION_ID);

    // Should not have inserted a new profile
    const calls = mockQuery.mock.calls.map(([sql]: [string]) => sql.trim().split('\n')[0].trim());
    expect(calls.some(c => c.startsWith('INSERT INTO dj_profiles'))).toBe(false);

    // Should have inserted 5 daypart assignments
    const daypartInserts = mockQuery.mock.calls.filter(([sql]: [string]) =>
      sql.includes('dj_daypart_assignments'),
    );
    expect(daypartInserts).toHaveLength(5);
  });

  it('creates a new default DJ profile when none exists for the company', async () => {
    // 1. dj_profiles table exists
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
    // 2. No existing default profile
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    // 3. Insert new profile returns id
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROFILE_ID }] });
    // 4-8. Five daypart inserts
    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    }
    // 9. dj_script_templates table exists
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
    // 10-(9+TEMPLATE_COUNT). Template inserts
    for (let i = 0; i < TEMPLATE_COUNT; i++) {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    }

    await seedDefaultDjProfileForStation(COMPANY_ID, STATION_ID);

    const profileInsert = mockQuery.mock.calls.find(([sql]: [string]) =>
      sql.includes('INSERT INTO dj_profiles'),
    );
    expect(profileInsert).toBeDefined();

    // Profile insert should include is_default = true
    expect(profileInsert![1]).toContain(true); // is_default

    // 5 daypart inserts
    const daypartInserts = mockQuery.mock.calls.filter(([sql]: [string]) =>
      sql.includes('dj_daypart_assignments'),
    );
    expect(daypartInserts).toHaveLength(5);
  });

  it('seeds all 5 standard dayparts (overnight, morning, midday, afternoon, evening)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: PROFILE_ID }] });
    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    }
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
    for (let i = 0; i < TEMPLATE_COUNT; i++) {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    }

    await seedDefaultDjProfileForStation(COMPANY_ID, STATION_ID);

    const daypartCalls = mockQuery.mock.calls.filter(([sql]: [string]) =>
      sql.includes('dj_daypart_assignments'),
    );

    const dayparts = daypartCalls.map(([, params]: [string, unknown[]]) => params[2]);
    expect(dayparts).toContain('overnight');
    expect(dayparts).toContain('morning');
    expect(dayparts).toContain('midday');
    expect(dayparts).toContain('afternoon');
    expect(dayparts).toContain('evening');
  });

  it('seeds default script templates for all segment types', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: PROFILE_ID }] });
    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    }
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
    for (let i = 0; i < TEMPLATE_COUNT; i++) {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    }

    await seedDefaultDjProfileForStation(COMPANY_ID, STATION_ID);

    const templateInserts = mockQuery.mock.calls.filter(([sql]: [string]) =>
      sql.includes('INSERT INTO dj_script_templates'),
    );
    // One INSERT per segment type
    expect(templateInserts).toHaveLength(TEMPLATE_COUNT);
  });

  it('skips template seeding when dj_script_templates table does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: PROFILE_ID }] });
    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    }
    // dj_script_templates table does NOT exist
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });

    await seedDefaultDjProfileForStation(COMPANY_ID, STATION_ID);

    const templateInserts = mockQuery.mock.calls.filter(([sql]: [string]) =>
      sql.includes('INSERT INTO dj_script_templates'),
    );
    expect(templateInserts).toHaveLength(0);
  });
});
