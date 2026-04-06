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

import { logLlmUsage, logTtsUsage } from '../../src/lib/usageLogger';

describe('usageLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('logLlmUsage', () => {
    it('inserts a row into dj_usage_log with usage_type=llm in the SQL', async () => {
      logLlmUsage({
        station_id: 'station-1',
        script_id: 'script-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });

      // Allow the fire-and-forget promise to resolve
      await new Promise((r) => setTimeout(r, 0));

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO dj_usage_log');
      // usage_type is hardcoded in SQL, not a parameter
      expect(sql).toContain("'llm'");
      expect(params).toContain('openai');
      expect(params).toContain('gpt-4o-mini');
      expect(params).toContain(100); // prompt_tokens
      expect(params).toContain(50);  // completion_tokens
      expect(params).toContain(150); // total_tokens
    });

    it('estimates cost_usd for known models', async () => {
      logLlmUsage({
        station_id: 'station-1',
        script_id: 'script-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
      });

      await new Promise((r) => setTimeout(r, 0));

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      // LLM params order: [station_id, script_id, segment_id, provider, model,
      //                    prompt_tokens, completion_tokens, total_tokens, cost_usd, metadata]
      // cost_usd is at index 8 (0-based)
      const costParam = params[8];
      // gpt-4o-mini: $0.15/1M input + $0.60/1M output = $0.75 for 1M each
      expect(costParam).toBeCloseTo(0.75, 5);
    });

    it('passes null cost_usd for unknown models', async () => {
      logLlmUsage({
        station_id: 'station-1',
        script_id: 'script-1',
        provider: 'custom',
        model: 'unknown-model-xyz',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });

      await new Promise((r) => setTimeout(r, 0));

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      // cost_usd at index 8 should be null for unknown model
      expect(params[8]).toBeNull();
    });

    it('does not throw when the DB query fails (fire-and-forget)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB unavailable'));

      // Should not throw
      expect(() => {
        logLlmUsage({
          station_id: 'station-1',
          script_id: 'script-1',
          provider: 'openai',
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }).not.toThrow();

      // Allow the rejection to be caught silently
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  describe('logTtsUsage', () => {
    it('inserts a row into dj_usage_log with usage_type=tts in the SQL', async () => {
      logTtsUsage({
        station_id: 'station-1',
        script_id: 'script-1',
        provider: 'openai',
        character_count: 500,
      });

      await new Promise((r) => setTimeout(r, 0));

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO dj_usage_log');
      // usage_type is hardcoded in SQL, not a parameter
      expect(sql).toContain("'tts'");
      expect(params).toContain('openai');
      expect(params).toContain(500); // character_count
    });

    it('estimates cost_usd for openai TTS', async () => {
      // openai: $15/1M chars → 1000 chars = $0.015
      logTtsUsage({
        station_id: 'station-1',
        script_id: 'script-1',
        provider: 'openai',
        character_count: 1000,
      });

      await new Promise((r) => setTimeout(r, 0));

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      // TTS params order: [station_id, script_id, segment_id, provider, character_count, cost_usd, metadata]
      // cost_usd is at index 5 (0-based)
      const costParam = params[5];
      expect(costParam).toBeCloseTo(0.015, 6);
    });

    it('does not throw when the DB query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB unavailable'));

      expect(() => {
        logTtsUsage({
          station_id: 'station-1',
          script_id: 'script-1',
          provider: 'elevenlabs',
          character_count: 200,
        });
      }).not.toThrow();

      await new Promise((r) => setTimeout(r, 0));
    });
  });
});
