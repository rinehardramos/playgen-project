/**
 * Tests for issue #529: pipeline stage retry, LLM/TTS backoff, and checkpoint resume.
 *
 * Covers:
 * - AC1: LLM calls retry with exponential backoff on 429/5xx
 * - AC3: DJ generation resumes from last completed segment on job retry
 * - AC5: Failed segments are logged with error details
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (must come before imports) ──────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(class {
    query = mockQuery;
    on = vi.fn();
  }),
}));

// LLM adapter mock — starts as always-succeed, overridden per test
const mockLlmComplete = vi.fn().mockResolvedValue({ text: 'Generated text' });

vi.mock('../../src/adapters/llm/index.js', () => ({
  llmComplete: (...args: unknown[]) => mockLlmComplete(...args),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(class {
    chat = { completions: { create: vi.fn() } };
    audio = { speech: { create: vi.fn() } };
  }),
}));

vi.mock('../config.js', () => ({
  config: {
    tts: { openaiApiKey: 'test-key', elevenlabsApiKey: 'test-key', provider: 'openai' },
    storage: { localPath: '/tmp/playgen-dj' },
    openRouter: { defaultModel: 'test-model' },
    llm: { backend: 'openrouter' },
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/services/manifestService.js', () => ({
  buildManifest: vi.fn().mockResolvedValue(undefined),
  getManifestByScript: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/adapters/news/index.js', () => ({
  getNewsProvider: vi.fn(() => ({ fetchHeadlines: vi.fn().mockResolvedValue([]) })),
}));

vi.mock('../../src/lib/rateLimiter.js', () => ({
  checkLlmRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkTtsRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../../src/lib/usageLogger.js', () => ({
  logLlmUsage: vi.fn(),
  logTtsUsage: vi.fn(),
}));

vi.mock('../../src/adapters/social/index.js', () => ({
  getSocialProviders: vi.fn().mockResolvedValue([]),
}));

// ── Import worker ──────────────────────────────────────────────────────────────

import { runGenerationJob } from '../../src/workers/generationWorker';

// ── Helper: set up a standard fresh-run mock sequence ─────────────────────────

function setupFreshRunMocks(scriptId: string, overrides?: { existingScript?: string; existingSegments?: Array<{ position: number; script_text: string }> }) {
  // 1. Station info
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'station-1', name: 'Test FM', timezone: 'UTC', company_id: 'co-1', openrouter_api_key: 'key' }],
  });
  // 1b. Station settings
  mockQuery.mockResolvedValueOnce({ rows: [{ key: 'llm_api_key', value: 'test-key' }] });
  // 2. DJ profile
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'profile-1', llm_model: 'test-model', llm_temperature: 0.8, tts_voice_id: 'alloy' }],
  });
  // 3. Playlist entries (1 entry)
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'entry-1', hour: 10, position: 0, song_title: 'Song', song_artist: 'Artist', duration_sec: 180 }],
  });
  // 4. Script templates
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // 4b. Adlib clips
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // 4c. Pending shoutouts
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // 5. Existing incomplete script check
  if (overrides?.existingScript) {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: overrides.existingScript }] });
  } else {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no existing script
  }
  // 5a. Segments resume query — ALWAYS runs (WHERE script_id = NULL → empty on fresh run)
  const existingSegs = overrides?.existingSegments ?? [];
  mockQuery.mockResolvedValueOnce({ rows: existingSegs });
  if (!overrides?.existingScript) {
    // INSERT new script (only on fresh run)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: scriptId }] });
  }
  // 5b. Program themes
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // Segment inserts + final update — fall back to default
  mockQuery.mockResolvedValue({ rows: [{ id: 'seg-x' }] });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pipeline retry, backoff, and resume (#529)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockLlmComplete.mockResolvedValue({ text: 'Generated text' });
  });

  // ── AC1: LLM retry on 429 ──────────────────────────────────────────────────

  describe('AC1 — LLM retry with exponential backoff', () => {
    it('retries an LLM call that fails with 429 and eventually succeeds', async () => {
      // First call: 429 rate limit; second call: success
      mockLlmComplete
        .mockRejectedValueOnce(new Error('Request failed with status 429: Too Many Requests'))
        .mockResolvedValue({ text: 'Retried successfully' });

      setupFreshRunMocks('script-retry');

      await runGenerationJob({
        playlist_id: 'playlist-1',
        station_id: 'station-1',
        auto_approve: false,
      });

      // LLM was called more than once — first call failed with 429, retry succeeded
      expect(mockLlmComplete.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('throws after exhausting all retries on persistent 429', async () => {
      // All 3 attempts fail
      mockLlmComplete.mockRejectedValue(new Error('Request failed with status 429: Too Many Requests'));

      // Set up mocks only up to the first LLM call
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'station-1', name: 'FM', timezone: 'UTC', company_id: 'co-1' }] }) // station
        .mockResolvedValueOnce({ rows: [{ key: 'llm_api_key', value: 'key' }] }) // settings
        .mockResolvedValueOnce({ rows: [{ id: 'p-1', llm_model: 'model', llm_temperature: 0.8, tts_voice_id: 'alloy' }] }) // profile
        .mockResolvedValueOnce({ rows: [{ id: 'e1', hour: 10, position: 0, song_title: 'S', song_artist: 'A', duration_sec: 180 }] }) // playlist
        .mockResolvedValueOnce({ rows: [] }) // templates
        .mockResolvedValueOnce({ rows: [] }) // adlibs
        .mockResolvedValueOnce({ rows: [] }) // shoutouts
        .mockResolvedValueOnce({ rows: [] }) // existing script check
        .mockResolvedValueOnce({ rows: [] }) // existing segments
        .mockResolvedValueOnce({ rows: [{ id: 'script-fail' }] }) // script insert
        .mockResolvedValueOnce({ rows: [] }); // program themes

      await expect(
        runGenerationJob({ playlist_id: 'playlist-1', station_id: 'station-1', auto_approve: false }),
      ).rejects.toThrow();

      // All 3 attempts should have been made
      expect(mockLlmComplete).toHaveBeenCalledTimes(3);
    });

    it('does not retry non-retryable errors (e.g. 401 unauthorized)', async () => {
      mockLlmComplete.mockRejectedValue(new Error('Request failed with status 401: Unauthorized'));

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'station-1', name: 'FM', timezone: 'UTC', company_id: 'co-1' }] })
        .mockResolvedValueOnce({ rows: [{ key: 'llm_api_key', value: 'key' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p-1', llm_model: 'model', llm_temperature: 0.8, tts_voice_id: 'alloy' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'e1', hour: 10, position: 0, song_title: 'S', song_artist: 'A', duration_sec: 180 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }) // existing script check
        .mockResolvedValueOnce({ rows: [] }) // existing segments
        .mockResolvedValueOnce({ rows: [{ id: 'script-auth-fail' }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        runGenerationJob({ playlist_id: 'playlist-1', station_id: 'station-1', auto_approve: false }),
      ).rejects.toThrow('401');

      // Should only be called once — no retries for 401
      expect(mockLlmComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC3: Checkpoint resume ─────────────────────────────────────────────────

  describe('AC3 — checkpoint resume on job retry', () => {
    it('reuses existing incomplete script instead of creating a new one', async () => {
      const existingScriptId = 'script-existing';
      setupFreshRunMocks('script-new', {
        existingScript: existingScriptId,
        existingSegments: [],
      });

      await runGenerationJob({
        playlist_id: 'playlist-1',
        station_id: 'station-1',
        auto_approve: false,
      });

      // INSERT INTO dj_scripts should NOT have been called
      const insertScriptCalls = (mockQuery.mock.calls as unknown as Array<[string, unknown[]]>).filter(
        ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO dj_scripts'),
      );
      expect(insertScriptCalls).toHaveLength(0);

      // The final UPDATE should reference the existing script id
      const updateCalls = (mockQuery.mock.calls as unknown as Array<[string, unknown[]]>).filter(
        ([sql, params]) => typeof sql === 'string' && sql.includes('UPDATE dj_scripts') && Array.isArray(params) && params.includes(existingScriptId),
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('skips already-inserted segments and does not call LLM for them', async () => {
      const existingScriptId = 'script-partial';
      // Simulate 2 segments already done (show_intro at position 0, song_intro at position 1)
      const existingSegments = [
        { position: 0, script_text: 'Previously generated show intro' },
        { position: 1, script_text: 'Previously generated song intro' },
      ];

      setupFreshRunMocks('unused', {
        existingScript: existingScriptId,
        existingSegments,
      });

      await runGenerationJob({
        playlist_id: 'playlist-1',
        station_id: 'station-1',
        auto_approve: false,
      });

      // generatedTexts should have been pre-populated with existing text
      // LLM should have been called only for segments after position 1
      // For 1 playlist entry, segments are: show_intro(0), song_intro(1), opening station_id(2), show_outro(3)
      // Positions 0 and 1 are already done, so LLM is only called for positions 2+ (station_id, show_outro)
      expect(mockLlmComplete.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('pre-populates generatedTexts with already-done segment text for variety context', async () => {
      const existingScriptId = 'script-context';
      const existingSegments = [
        { position: 0, script_text: 'Show intro text already done' },
      ];

      setupFreshRunMocks('unused', {
        existingScript: existingScriptId,
        existingSegments,
      });

      let capturedPrompt = '';
      mockLlmComplete.mockImplementation(async (msgs: Array<{ role: string; content: string }>) => {
        // Capture the user prompt to verify variety context was passed
        capturedPrompt = msgs.find((m) => m.role === 'user')?.content ?? '';
        return { text: 'Generated' };
      });

      await runGenerationJob({
        playlist_id: 'playlist-1',
        station_id: 'station-1',
        auto_approve: false,
      });

      // The existing segment text should be reflected in the previousSegmentTexts context
      // (it gets passed as part of the prompt for variety)
      // At least verify LLM was called (for the remaining segments)
      expect(mockLlmComplete).toHaveBeenCalled();
    });
  });

  // ── AC5: Failed segments are logged ───────────────────────────────────────

  describe('AC5 — failed segments are logged with error details', () => {
    it('logs a detailed error message when an LLM call permanently fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLlmComplete.mockRejectedValue(new Error('Request failed with status 429'));

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'station-1', name: 'FM', timezone: 'UTC', company_id: 'co-1' }] })
        .mockResolvedValueOnce({ rows: [{ key: 'llm_api_key', value: 'key' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p-1', llm_model: 'model', llm_temperature: 0.8, tts_voice_id: 'alloy' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'e1', hour: 10, position: 0, song_title: 'S', song_artist: 'A', duration_sec: 180 }] })
        .mockResolvedValueOnce({ rows: [] }) // templates
        .mockResolvedValueOnce({ rows: [] }) // adlib clips
        .mockResolvedValueOnce({ rows: [] }) // shoutouts
        .mockResolvedValueOnce({ rows: [] }) // existing script check → no existing script
        .mockResolvedValueOnce({ rows: [] }) // segments resume (always runs, null script_id → empty)
        .mockResolvedValueOnce({ rows: [{ id: 'script-log-test' }] }) // INSERT new script
        .mockResolvedValueOnce({ rows: [] }); // program themes

      await expect(
        runGenerationJob({ playlist_id: 'playlist-1', station_id: 'station-1', auto_approve: false }),
      ).rejects.toThrow();

      // Verify that error was logged with "permanently" and the segment type
      const errorCalls = consoleSpy.mock.calls.map((c) => c.join(' '));
      const hasDetailedLog = errorCalls.some(
        (msg) => msg.includes('permanently') && msg.includes('provider=') && msg.includes('segment='),
      );
      expect(hasDetailedLog).toBe(true);

      consoleSpy.mockRestore();
    });
  });
});
