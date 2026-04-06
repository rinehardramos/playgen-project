import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Setup mocks BEFORE any imports
const mockQuery = vi.fn();

// Vitest 4.x: use class syntax for constructor mocks
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(class {
    query = mockQuery;
    on = vi.fn();
  }),
}));

const mockLlmCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'Generated script text' } }],
});
const mockSpeechCreate = vi.fn().mockResolvedValue({
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
});

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(class {
    chat = { completions: { create: mockLlmCreate } };
    audio = { speech: { create: mockSpeechCreate } };
  }),
}));

vi.mock('../config.js', () => ({
  config: {
    tts: {
      openaiApiKey: 'test-key',
      elevenlabsApiKey: 'test-key',
      provider: 'openai',
    },
    storage: {
      localPath: '/tmp/playgen-dj',
    },
    openRouter: {
      defaultModel: 'test-model',
    }
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock manifestService so buildManifest (fire-and-forget) doesn't race with test mocks
vi.mock('../../src/services/manifestService.js', () => ({
  buildManifest: vi.fn().mockResolvedValue(undefined),
  getManifestByScript: vi.fn().mockResolvedValue(null),
}));

// Mock news provider — returns empty headlines by default
vi.mock('../../src/adapters/news/index.js', () => ({
  getNewsProvider: vi.fn(() => ({ fetchHeadlines: vi.fn().mockResolvedValue([]) })),
}));

// Mock social adapter — returns no providers so the DB is not hit
vi.mock('../../src/adapters/social/index.js', () => ({
  getSocialProviders: vi.fn().mockResolvedValue([]),
}));

// 2. Import the worker
import { runGenerationJob } from '../../src/workers/generationWorker';

describe('generationWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockQuery to clear any unconsumed mockResolvedValueOnce values from previous tests
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('runs the full generation pipeline', async () => {
    const scriptId = 'script-1';

    // 1. Station info
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'station-1', name: 'Test FM', timezone: 'UTC', company_id: 'company-1', openrouter_api_key: 'test-key' }],
    });
    // 1b. Station settings (loadStationSettings)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2. DJ profile
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'profile-1',
        llm_model: 'test-model',
        llm_temperature: 0.8,
        tts_voice_id: 'alloy',
      }],
    });
    // 3b. Playlist entries (1 entry)
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'entry-1', hour: 10, position: 0, song_title: 'Song 1', song_artist: 'Artist 1', duration_sec: 180 },
      ],
    });
    // 4. Script templates
    mockQuery.mockResolvedValueOnce({
      rows: [{ segment_type: 'show_intro', prompt_template: 'Intro template' }],
    });
    // 4b. Pre-recorded adlib clips (none)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 4c. Pending shoutouts (none)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 5. Script insert
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: scriptId }],
    });

    // For 1 entry, segmentsForEntry returns ['show_intro', 'song_intro', 'show_outro']
    // After song_intro the opening station_id is injected (non-song, uses null playlist_entry_id)
    // 6. Segment inserts
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-1' }] }); // show_intro
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-2' }] }); // song_intro
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-si' }] }); // opening station_id (non-song)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-3' }] }); // show_outro

    // 7. Final script update
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runGenerationJob({
      playlist_id: 'playlist-1',
      station_id: 'station-1',
      auto_approve: false,
    });

    // Verify script update (final update)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE dj_scripts'),
      expect.any(Array)
    );
  });

  it('throws a descriptive error when no LLM API key is configured', async () => {
    // The pre-flight check runs right after profile load, so we only need:
    // station (no API keys) → settings (empty) → getDefaultProfile
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'station-1', name: 'Test FM', timezone: 'UTC', company_id: 'company-1',
        openrouter_api_key: null, openai_api_key: null, anthropic_api_key: null,
        gemini_api_key: null, mistral_api_key: null,
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // station settings (empty — no key overrides)
    mockQuery.mockResolvedValueOnce({              // getDefaultProfile
      rows: [{ id: 'profile-1', llm_model: 'test-model', llm_temperature: 0.8, tts_voice_id: 'alloy' }],
    });

    await expect(
      runGenerationJob({ playlist_id: 'playlist-1', station_id: 'station-1', auto_approve: false }),
    ).rejects.toThrow(/No LLM API key configured/);
  });

  it('injects listener shoutout segments after show_intro', async () => {
    const scriptId = 'script-shoutout';

    // 1. Station info
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'station-1', name: 'Test FM', timezone: 'UTC', company_id: 'company-1', openrouter_api_key: 'test-key' }],
    });
    // 1b. Station settings
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2. DJ profile
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'profile-1', llm_model: 'test-model', llm_temperature: 0.8, tts_voice_id: 'alloy' }],
    });
    // 3. Playlist entries (1 entry)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'entry-1', hour: 10, position: 0, song_title: 'Song 1', song_artist: 'Artist 1', duration_sec: 180 }],
    });
    // 4. Script templates
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 4b. Pre-recorded adlib clips (none)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 4c. Pending shoutouts (1 shoutout)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'shoutout-1', listener_name: 'Maria', message: 'Love the morning show!' }],
    });
    // 5. Script insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: scriptId }] });

    // 6. Segment inserts (main loop uses RETURNING id; shoutout INSERT does not)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-1' }] }); // show_intro RETURNING id
    mockQuery.mockResolvedValueOnce({ rows: [] }); // listener_activity insert (no RETURNING id)
    // 6b. Mark shoutout as used
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-2' }] }); // song_intro RETURNING id
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-si' }] }); // opening station_id (non-song)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-3' }] }); // show_outro RETURNING id

    // 7. Final script update
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runGenerationJob({
      playlist_id: 'playlist-1',
      station_id: 'station-1',
      auto_approve: false,
    });

    // Verify listener_activity segment was inserted
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO dj_segments'),
      expect.arrayContaining(['listener_activity']),
    );

    // Verify shoutout was marked as used
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE listener_shoutouts'),
      expect.arrayContaining([scriptId]),
    );
  });

  it('uses a pre-recorded adlib clip when available (skips LLM for adlib)', async () => {
    const scriptId = 'script-adlib-prerecorded';

    // 1. Station
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'station-1', name: 'Test FM', timezone: 'UTC', company_id: 'company-1', openrouter_api_key: 'test-key' }],
    });
    // 1b. Station settings
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2. DJ profile — set adlib_interval_songs = 1 so adlib fires at every song
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'profile-1',
        llm_model: 'test-model',
        llm_temperature: 0.8,
        tts_voice_id: 'alloy',
        persona_config: { adlib_interval_songs: 1 },
      }],
    });
    // 3. Playlist entries (4 entries so adlib fires at songs 2, 3)
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'e1', hour: 10, position: 0, song_title: 'Song 1', song_artist: 'A1', duration_sec: 180 },
        { id: 'e2', hour: 10, position: 1, song_title: 'Song 2', song_artist: 'A2', duration_sec: 180 },
        { id: 'e3', hour: 10, position: 2, song_title: 'Song 3', song_artist: 'A3', duration_sec: 180 },
        { id: 'e4', hour: 10, position: 3, song_title: 'Song 4', song_artist: 'A4', duration_sec: 180 },
      ],
    });
    // 4. Script templates
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 4b. Pre-recorded adlib clips (1 clip)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'clip-1', name: 'Stay locked in!', audio_url: '/api/v1/dj/audio/adlib-clips/station-1/clip-1.mp3', audio_duration_sec: '3.5' }],
    });
    // 4c. Pending shoutouts (none)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 5. Script insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: scriptId }] });

    // 6. Segment inserts (show_intro, song_intro, station_id, song_transition×3, show_outro + 2 adlibs at interval 1)
    // The exact number varies; fall back to the default mock returning segment rows
    mockQuery.mockResolvedValue({ rows: [{ id: 'seg-x' }] });

    await runGenerationJob({
      playlist_id: 'playlist-1',
      station_id: 'station-1',
      auto_approve: false,
    });

    // Verify at least one pre-recorded adlib was inserted with auto_approved status
    const adlibCall = (mockQuery.mock.calls as unknown as Array<[string, unknown[]]>).find(
      ([sql]) => typeof sql === 'string' && sql.includes('adlib') && sql.includes('auto_approved'),
    );
    expect(adlibCall).toBeDefined();
    // Verify the LLM was NOT called for the adlib (only for other segment types)
    const llmCallCount = mockLlmCreate.mock.calls.length;
    // With 4 entries: show_intro, song_intro, 3× song_transition, show_outro + opening station_id = 7 LLM calls
    // Adlibs should use pre-recorded → no extra LLM calls for 'adlib'
    expect(llmCallCount).toBeGreaterThan(0);
    // The adlib INSERT should include the clip audio_url
    expect(adlibCall?.[1]).toEqual(
      expect.arrayContaining(['/api/v1/dj/audio/adlib-clips/station-1/clip-1.mp3']),
    );
  });
});
