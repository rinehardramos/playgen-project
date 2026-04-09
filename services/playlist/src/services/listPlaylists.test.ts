/**
 * Unit tests for listPlaylists — month and date filter params.
 *
 * The DB pool is mocked so no real database is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({ getPool: vi.fn() }));

import { getPool } from '../db';
import { listPlaylists } from './playlistService';

const mockGetPool = vi.mocked(getPool);

const STATION_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

const PLAYLIST_ROW = {
  id: 'bbbbbbbb-0000-0000-0000-000000000002',
  station_id: STATION_ID,
  template_id: null,
  date: '2026-04-08',
  status: 'ready',
  generated_at: null,
  generated_by: null,
  approved_at: null,
  approved_by: null,
  notes: null,
};

function buildMockPool(rows: unknown[]) {
  const mockQuery = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
  return { query: mockQuery };
}

describe('listPlaylists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries by exact date when date param provided', async () => {
    const pool = buildMockPool([PLAYLIST_ROW]);
    mockGetPool.mockReturnValue(pool as ReturnType<typeof getPool>);

    const result = await listPlaylists(STATION_ID, { date: '2026-04-08' });

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-04-08');

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE station_id = \$1 AND date = \$2/);
    expect(params).toEqual([STATION_ID, '2026-04-08']);
  });

  it('throws on invalid date format', async () => {
    const pool = buildMockPool([]);
    mockGetPool.mockReturnValue(pool as ReturnType<typeof getPool>);

    await expect(listPlaylists(STATION_ID, { date: '08-04-2026' })).rejects.toThrow(
      'date must be in YYYY-MM-DD format'
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns empty array when no playlist exists for the date', async () => {
    const pool = buildMockPool([]);
    mockGetPool.mockReturnValue(pool as ReturnType<typeof getPool>);

    const result = await listPlaylists(STATION_ID, { date: '2026-04-09' });

    expect(result).toEqual([]);
  });

  it('still uses month range query when only month param provided', async () => {
    const pool = buildMockPool([PLAYLIST_ROW]);
    mockGetPool.mockReturnValue(pool as ReturnType<typeof getPool>);

    await listPlaylists(STATION_ID, { month: '2026-04' });

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/date BETWEEN \$2 AND \$3/);
    expect(params[0]).toBe(STATION_ID);
    expect(params[1]).toBe('2026-04-01');
  });

  it('date param takes priority over month param when both provided', async () => {
    const pool = buildMockPool([PLAYLIST_ROW]);
    mockGetPool.mockReturnValue(pool as ReturnType<typeof getPool>);

    await listPlaylists(STATION_ID, { date: '2026-04-08', month: '2026-04' });

    const [sql] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE station_id = \$1 AND date = \$2/);
  });
});
