import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePool(queryImpl: (...args: unknown[]) => unknown): Pool {
  return { query: vi.fn(queryImpl) } as unknown as Pool;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const COMPANY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const STATION_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

describe('writeLog — fire-and-forget', () => {
  it('issues an INSERT query with all fields', async () => {
    const { writeLog } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const pool = makePool(mockQuery);

    writeLog(pool, {
      level: 'info',
      category: 'dj',
      company_id: COMPANY_ID,
      station_id: STATION_ID,
      user_id: null,
      message: 'test message',
      metadata: { key: 'value' },
    });

    // Give the micro-task queue a tick so the promise is enqueued
    await Promise.resolve();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO system_logs');
    expect(params).toContain('info');
    expect(params).toContain('dj');
    expect(params).toContain(COMPANY_ID);
    expect(params).toContain('test message');
  });

  it('swallows DB errors and does not throw', async () => {
    const { writeLog } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn().mockRejectedValue(new Error('DB is down'));
    const pool = makePool(mockQuery);

    // Must not throw — caller never awaits this
    expect(() => writeLog(pool, {
      level: 'error',
      category: 'system',
      message: 'something went wrong',
    })).not.toThrow();

    // Let the rejection propagate and be caught internally
    await new Promise((r) => setTimeout(r, 10));
    // No unhandled rejection — test would fail if one escaped
  });

  it('sets optional fields to null when omitted', async () => {
    const { writeLog } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
    const pool = makePool(mockQuery);

    writeLog(pool, { level: 'warn', category: 'config', message: 'minimal log' });

    await Promise.resolve();

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    // company_id, station_id, user_id should all be null
    expect(params[2]).toBeNull();
    expect(params[3]).toBeNull();
    expect(params[4]).toBeNull();
    // metadata null when omitted
    expect(params[6]).toBeNull();
  });
});

describe('listLogs — dynamic query building', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns paginated data with correct shape', async () => {
    const { listLogs } = await import('../../src/services/systemLogService');

    const sampleRow = {
      id: 'log-1',
      created_at: '2026-04-06T00:00:00Z',
      level: 'info',
      category: 'dj',
      company_id: COMPANY_ID,
      station_id: null,
      user_id: null,
      message: 'Script generated',
      metadata: null,
    };

    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: '42' }] })   // COUNT query
      .mockResolvedValueOnce({ rows: [sampleRow] });          // data query

    const pool = makePool(mockQuery);

    const result = await listLogs(pool, { company_id: COMPANY_ID, page: 1, limit: 50 });

    expect(result.total).toBe(42);
    expect(result.page).toBe(1);
    expect(result.pages).toBe(1);      // ceil(42/50) = 1
    expect(result.data).toHaveLength(1);
    expect(result.data[0].message).toBe('Script generated');
  });

  it('applies level filter as SQL parameter', async () => {
    const { listLogs } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const pool = makePool(mockQuery);

    await listLogs(pool, { company_id: COMPANY_ID, level: 'error' });

    const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('level = ');
    expect(countParams).toContain('error');
  });

  it('applies category filter as SQL parameter', async () => {
    const { listLogs } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const pool = makePool(mockQuery);

    await listLogs(pool, { company_id: COMPANY_ID, category: 'tts' });

    const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('category = ');
    expect(countParams).toContain('tts');
  });

  it('clamps page to minimum of 1', async () => {
    const { listLogs } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [] });

    const pool = makePool(mockQuery);

    const result = await listLogs(pool, { company_id: COMPANY_ID, page: -5, limit: 10 });
    expect(result.page).toBe(1);
  });

  it('clamps limit to maximum of 100', async () => {
    const { listLogs } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: '200' }] })
      .mockResolvedValueOnce({ rows: [] });

    const pool = makePool(mockQuery);

    const result = await listLogs(pool, { company_id: COMPANY_ID, limit: 999 });
    // pages = ceil(200 / 100) = 2
    expect(result.pages).toBe(2);
  });

  it('calculates pages correctly', async () => {
    const { listLogs } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: '101' }] })
      .mockResolvedValueOnce({ rows: [] });

    const pool = makePool(mockQuery);

    const result = await listLogs(pool, { company_id: COMPANY_ID, limit: 50 });
    expect(result.pages).toBe(3);  // ceil(101/50) = 3
  });
});

describe('purgeOldLogs — scoped to company', () => {
  it('passes company_id as parameter to DELETE', async () => {
    const { purgeOldLogs } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ count: '7' }] });
    const pool = makePool(mockQuery);

    const deleted = await purgeOldLogs(pool, COMPANY_ID);

    expect(deleted).toBe(7);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('company_id = $1');
    expect(params[0]).toBe(COMPANY_ID);
    // Must NOT be a global purge — company_id must be in the query
    expect(sql.toLowerCase()).toContain('company_id');
  });

  it('returns 0 when no logs are purged', async () => {
    const { purgeOldLogs } = await import('../../src/services/systemLogService');

    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ count: '0' }] });
    const pool = makePool(mockQuery);

    const deleted = await purgeOldLogs(pool, COMPANY_ID);
    expect(deleted).toBe(0);
  });
});
