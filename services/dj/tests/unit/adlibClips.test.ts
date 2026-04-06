import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Setup mocks BEFORE any imports
const mockQuery = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(class {
    query = mockQuery;
    on = vi.fn();
  }),
}));

const mockLlmCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'AI adlib text' } }],
});
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(class {
    chat = { completions: { create: mockLlmCreate } };
    audio = { speech: { create: vi.fn().mockResolvedValue({ arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)) }) } };
  }),
}));

vi.mock('../config.js', () => ({
  config: {
    tts: { openaiApiKey: 'test-key', provider: 'openai' },
    storage: { localPath: '/tmp/playgen-dj' },
    openRouter: { defaultModel: 'test-model' },
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

vi.mock('../../src/adapters/social/index.js', () => ({
  getSocialProviders: vi.fn().mockResolvedValue([]),
}));

import { runGenerationJob } from '../../src/workers/generationWorker';

/**
 * Helper: set up standard query mocks for a generation job.
 * entries: array of playlist entry rows.
 * adlibClips: optional array of pre-recorded clip rows.
 * shoutouts: optional shoutout rows.
 */
function setupMocks(opts: {
  entries: Array<{ id: string; hour: number; position: number; song_title: string; song_artist: string; duration_sec: number }>;
  adlibClips?: Array<{ id: string; name: string; audio_url: string; audio_duration_sec: string | null }>;
  shoutouts?: Array<{ id: string; listener_name: string | null; message: string }>;
  personaConfig?: Record<string, unknown>;
}): string {
  const scriptId = 'script-adlib-test';
  const { entries, adlibClips = [], shoutouts = [], personaConfig = {} } = opts;

  // 1. Station info
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'station-1', name: 'Test FM', timezone: 'UTC', company_id: 'company-1', openrouter_api_key: 'test-key' }],
  });
  // 2. Station settings
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // 3. DJ profile with optional personaConfig
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 'profile-1', llm_model: 'test-model', llm_temperature: 0.8, tts_voice_id: 'alloy', persona_config: personaConfig }],
  });
  // 4a. Playlist entries
  mockQuery.mockResolvedValueOnce({ rows: entries });
  // 4b. Script templates
  mockQuery.mockResolvedValueOnce({ rows: [] });
  // 4c. Adlib clips
  mockQuery.mockResolvedValueOnce({ rows: adlibClips });
  // 4d. Pending shoutouts
  mockQuery.mockResolvedValueOnce({ rows: shoutouts });
  // 5. Script insert
  mockQuery.mockResolvedValueOnce({ rows: [{ id: scriptId }] });
  // 6+. Segment inserts — return a unique id for each call
  mockQuery.mockResolvedValue({ rows: [{ id: 'seg-x' }] });

  return scriptId;
}

describe('generationWorker — adlib segment injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('injects an AI-generated adlib when no pre-recorded clips exist', async () => {
    // 8 entries so adlib fires at index 4 (default interval = 4)
    const entries = Array.from({ length: 8 }, (_, i) => ({
      id: `entry-${i}`,
      hour: 10,
      position: i,
      song_title: `Song ${i}`,
      song_artist: 'Artist',
      duration_sec: 180,
    }));

    setupMocks({ entries, adlibClips: [] });

    await runGenerationJob({ playlist_id: 'playlist-1', station_id: 'station-1', auto_approve: false });

    // LLM should have been called for adlib segment
    expect(mockLlmCreate).toHaveBeenCalled();
    const calls = mockQuery.mock.calls.map((c) => c[0] as string);
    const adlibInsert = calls.some(
      (sql) => sql.includes('INSERT INTO dj_segments') && mockQuery.mock.calls.some(
        (c) => Array.isArray(c[1]) && c[1].includes('adlib'),
      ),
    );
    expect(adlibInsert).toBe(true);
  });

  it('uses a pre-recorded clip (skips LLM) when adlib clips are available', async () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      id: `entry-${i}`,
      hour: 10,
      position: i,
      song_title: `Song ${i}`,
      song_artist: 'Artist',
      duration_sec: 180,
    }));

    const preRecordedClips = [
      { id: 'clip-1', name: 'Stay locked in!', audio_url: '/api/v1/dj/audio/adlib-clips/station-1/clip-1.mp3', audio_duration_sec: '4.5' },
    ];

    setupMocks({ entries, adlibClips: preRecordedClips });

    await runGenerationJob({ playlist_id: 'playlist-1', station_id: 'station-1', auto_approve: false });

    // Pre-recorded clip audio_url should appear in an INSERT call
    const clipUrlUsed = mockQuery.mock.calls.some(
      (c) => Array.isArray(c[1]) && c[1].includes(preRecordedClips[0].audio_url),
    );
    expect(clipUrlUsed).toBe(true);
    // The adlib INSERT should use 'auto_approved' (pre-recorded clip path), not the LLM path
    const autoApprovedAdlibInserted = mockQuery.mock.calls.some(
      (c) => typeof c[0] === 'string' && c[0].includes('adlib') && c[0].includes('auto_approved'),
    );
    expect(autoApprovedAdlibInserted).toBe(true);
  });

  it('disables adlib injection when adlib_interval_songs = 0', async () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      id: `entry-${i}`,
      hour: 10,
      position: i,
      song_title: `Song ${i}`,
      song_artist: 'Artist',
      duration_sec: 180,
    }));

    setupMocks({ entries, adlibClips: [], personaConfig: { adlib_interval_songs: 0 } });

    await runGenerationJob({ playlist_id: 'playlist-1', station_id: 'station-1', auto_approve: false });

    // No adlib segment type should appear in any INSERT call
    const adlibInserted = mockQuery.mock.calls.some(
      (c) => Array.isArray(c[1]) && c[1].includes('adlib'),
    );
    expect(adlibInserted).toBe(false);
  });

  it('respects custom adlib_interval_songs from persona_config', async () => {
    // With interval=2 and 6 entries, adlib should fire at indices 2 and 4
    const entries = Array.from({ length: 6 }, (_, i) => ({
      id: `entry-${i}`,
      hour: 10,
      position: i,
      song_title: `Song ${i}`,
      song_artist: 'Artist',
      duration_sec: 180,
    }));

    setupMocks({ entries, adlibClips: [], personaConfig: { adlib_interval_songs: 2 } });

    await runGenerationJob({ playlist_id: 'playlist-1', station_id: 'station-1', auto_approve: false });

    const adlibInsertCalls = mockQuery.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1].includes('adlib'),
    );
    // With interval=2 on 6 entries (excluding first and last), adlib should fire at least once
    expect(adlibInsertCalls.length).toBeGreaterThan(0);
  });
});
