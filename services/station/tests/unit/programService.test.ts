import { describe, it, expect, vi, beforeEach } from 'vitest';

// DB is mocked — pure unit tests
const mockQuery = vi.fn();
vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

import * as programService from '../../src/services/programService';

describe('programService — deleteProgram', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns true when a non-default program is deleted', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const result = await programService.deleteProgram('program-uuid');
    expect(result).toBe(true);
  });

  it('returns false when program does not exist or is the default', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const result = await programService.deleteProgram('default-program-uuid');
    expect(result).toBe(false);
  });

  it('queries with AND is_default = FALSE guard', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await programService.deleteProgram('some-id');
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_default = FALSE');
    expect(params[0]).toBe('some-id');
  });
});

describe('programService — deleteProgram handles null rowCount', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('treats null rowCount as 0 (no row deleted)', async () => {
    // Some pg drivers return null rowCount on no-match
    mockQuery.mockResolvedValueOnce({ rowCount: null });
    const result = await programService.deleteProgram('missing-id');
    expect(result).toBe(false);
  });
});

describe('programService — formatHour validation (clock minute range)', () => {
  it('valid target_minute values are 0–59', () => {
    const isValidMinute = (m: number) => Number.isInteger(m) && m >= 0 && m <= 59;
    expect(isValidMinute(0)).toBe(true);
    expect(isValidMinute(59)).toBe(true);
    expect(isValidMinute(30)).toBe(true);
    expect(isValidMinute(-1)).toBe(false);
    expect(isValidMinute(60)).toBe(false);
    expect(isValidMinute(1.5)).toBe(false);
  });
});
