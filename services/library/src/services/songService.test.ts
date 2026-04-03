import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listSongs, createSong } from './songService';

const mockQuery = vi.fn();
const mockConnect = vi.fn();

vi.mock('../db', () => ({
  getPool: () => ({
    query: mockQuery,
    connect: mockConnect,
  }),
}));

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSongRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'song-1',
    company_id: 'company-1',
    station_id: 'station-1',
    category_id: 'cat-1',
    title: 'Test Song',
    artist: 'Test Artist',
    duration_sec: 210,
    is_active: true,
    raw_material: null,
    created_at: new Date(),
    updated_at: new Date(),
    eligible_hours: [8, 9, 10],
    ...overrides,
  };
}

// ─── listSongs ────────────────────────────────────────────────────────────────

describe('listSongs', () => {
  it('returns a PaginatedResponse with data and meta', async () => {
    const row = makeSongRow();
    // Promise.all fires two queries: data + count
    mockQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await listSongs('station-1', {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('song-1');
    expect(result.data[0].eligible_hours).toEqual([8, 9, 10]);

    expect(result.meta).toMatchObject({
      page: 1,
      total: 1,
      total_pages: 1,
    });
  });

  it('uses default pagination (page=1, limit=50) when no opts provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await listSongs('station-1', {});

    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(50);
  });

  it('replaces null eligible_hours with an empty array', async () => {
    const row = makeSongRow({ eligible_hours: null });
    mockQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await listSongs('station-1', {});

    expect(result.data[0].eligible_hours).toEqual([]);
  });

  it('includes a search filter in the SQL query when opts.search is provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await listSongs('station-1', { search: 'rock' });

    // Both calls should have '%rock%' in their parameters
    const dataCallArgs = mockQuery.mock.calls[0];
    const countCallArgs = mockQuery.mock.calls[1];

    expect(dataCallArgs[1]).toContain('%rock%');
    expect(countCallArgs[1]).toContain('%rock%');
  });

  it('includes a category_id filter in the SQL query when opts.category_id is provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await listSongs('station-1', { category_id: 'cat-99' });

    const dataCallArgs = mockQuery.mock.calls[0];
    const countCallArgs = mockQuery.mock.calls[1];

    expect(dataCallArgs[1]).toContain('cat-99');
    expect(countCallArgs[1]).toContain('cat-99');
  });

  it('respects caller-supplied page and limit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '100' }] });

    const result = await listSongs('station-1', { page: 3, limit: 10 });

    expect(result.meta.page).toBe(3);
    expect(result.meta.limit).toBe(10);
    expect(result.meta.total_pages).toBe(10);
  });
});

// ─── createSong ───────────────────────────────────────────────────────────────

describe('createSong', () => {
  function makeClient(queryResponses: Array<unknown>) {
    let callIndex = 0;
    return {
      query: vi.fn().mockImplementation(() => {
        const response = queryResponses[callIndex] ?? { rows: [] };
        callIndex++;
        return Promise.resolve(response);
      }),
      release: vi.fn(),
    };
  }

  it('inserts a song with eligible_hours and returns the song with eligible_hours attached', async () => {
    const insertedSong = makeSongRow({ eligible_hours: undefined });
    const client = makeClient([
      { rows: [] },               // BEGIN
      { rows: [insertedSong] },   // INSERT songs
      { rows: [] },               // INSERT song_slots
      { rows: [] },               // COMMIT
    ]);
    mockConnect.mockResolvedValue(client);

    const result = await createSong({
      company_id: 'company-1',
      station_id: 'station-1',
      category_id: 'cat-1',
      title: 'New Song',
      artist: 'New Artist',
      eligible_hours: [8, 9, 10],
    });

    expect(result.id).toBe('song-1');
    expect(result.eligible_hours).toEqual([8, 9, 10]);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('creates a song without eligible_hours when none are provided', async () => {
    const insertedSong = makeSongRow({ eligible_hours: undefined });
    const client = makeClient([
      { rows: [] },             // BEGIN
      { rows: [insertedSong] }, // INSERT songs
      { rows: [] },             // COMMIT
    ]);
    mockConnect.mockResolvedValue(client);

    const result = await createSong({
      company_id: 'company-1',
      station_id: 'station-1',
      category_id: 'cat-1',
      title: 'No Slots Song',
      artist: 'Artist X',
    });

    expect(result.eligible_hours).toEqual([]);

    // song_slots INSERT should NOT have been called
    const queryArgs = client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    const slotInsertCalled = queryArgs.some((sql: string) =>
      typeof sql === 'string' && sql.includes('song_slots')
    );
    expect(slotInsertCalled).toBe(false);
  });

  it('rolls back and rethrows when the insert fails', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })      // BEGIN
        .mockRejectedValueOnce(new Error('DB error')), // INSERT songs
      release: vi.fn(),
    };
    mockConnect.mockResolvedValue(client);

    await expect(
      createSong({
        company_id: 'company-1',
        station_id: 'station-1',
        category_id: 'cat-1',
        title: 'Fail Song',
        artist: 'Fail Artist',
      })
    ).rejects.toThrow('DB error');

    const queryArgs = client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(queryArgs).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
