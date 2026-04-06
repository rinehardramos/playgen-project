import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(class {
    query = mockQuery;
    on = vi.fn();
  }),
}));

vi.mock('../../src/config.js', () => ({
  config: {
    database: { url: 'postgres://test' },
  },
}));

import { checkLlmRateLimit, checkTtsRateLimit } from '../../src/lib/rateLimiter';

describe('rateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkLlmRateLimit', () => {
    it('allows when no limit is configured (no setting row)', async () => {
      // No llm_calls_per_day setting
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await checkLlmRateLimit('station-1');

      expect(result.allowed).toBe(true);
      expect(mockQuery).toHaveBeenCalledOnce();
    });

    it('allows when usage is below the configured limit', async () => {
      // Limit = 10
      mockQuery.mockResolvedValueOnce({ rows: [{ value: '10' }] });
      // Today's count = 5
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const result = await checkLlmRateLimit('station-1');

      expect(result.allowed).toBe(true);
    });

    it('blocks when usage exactly equals the limit', async () => {
      // Limit = 5
      mockQuery.mockResolvedValueOnce({ rows: [{ value: '5' }] });
      // Today's count = 5
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const result = await checkLlmRateLimit('station-1');

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/rate limit/i);
    });

    it('blocks when usage exceeds the limit', async () => {
      // Limit = 3
      mockQuery.mockResolvedValueOnce({ rows: [{ value: '3' }] });
      // Today's count = 7
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '7' }] });

      const result = await checkLlmRateLimit('station-1');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('7/3');
    });

    it('allows when limit is 0 or non-numeric (treated as unlimited)', async () => {
      // Invalid limit
      mockQuery.mockResolvedValueOnce({ rows: [{ value: '0' }] });

      const result = await checkLlmRateLimit('station-1');

      expect(result.allowed).toBe(true);
    });
  });

  describe('checkTtsRateLimit', () => {
    it('allows when no limit is configured', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await checkTtsRateLimit('station-1', 500);

      expect(result.allowed).toBe(true);
    });

    it('allows when chars used + pending is below the limit', async () => {
      // Limit = 10000
      mockQuery.mockResolvedValueOnce({ rows: [{ value: '10000' }] });
      // Used today = 8000
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '8000' }] });

      // 8000 + 500 = 8500 < 10000 → allowed
      const result = await checkTtsRateLimit('station-1', 500);

      expect(result.allowed).toBe(true);
    });

    it('blocks when chars used + pending exceeds the limit', async () => {
      // Limit = 10000
      mockQuery.mockResolvedValueOnce({ rows: [{ value: '10000' }] });
      // Used today = 9800
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '9800' }] });

      // 9800 + 500 = 10300 > 10000 → blocked
      const result = await checkTtsRateLimit('station-1', 500);

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/rate limit/i);
    });

    it('blocks when chars used exactly equals the limit', async () => {
      // Limit = 1000
      mockQuery.mockResolvedValueOnce({ rows: [{ value: '1000' }] });
      // Used today = 1000
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '1000' }] });

      // 1000 + 1 = 1001 > 1000 → blocked
      const result = await checkTtsRateLimit('station-1', 1);

      expect(result.allowed).toBe(false);
    });

    it('allows when today\'s usage total is null (no rows yet)', async () => {
      // Limit = 5000
      mockQuery.mockResolvedValueOnce({ rows: [{ value: '5000' }] });
      // No rows today — SUM returns null, coalesced to 0
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await checkTtsRateLimit('station-1', 100);

      expect(result.allowed).toBe(true);
    });
  });
});
