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

// 2. Import the worker
import { runGenerationJob } from '../../src/workers/generationWorker';

describe('generationWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock response for queries that don't need specific rows
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('runs the full generation pipeline', async () => {
    const scriptId = 'script-1';

    // 1. Station info
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'station-1', name: 'Test FM', timezone: 'UTC', company_id: 'company-1' }],
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
    // 3. Playlist info (playlist_date)
    mockQuery.mockResolvedValueOnce({
      rows: [{ playlist_date: new Date() }],
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
    // 5. Script insert
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: scriptId }],
    });
    
    // For 1 entry, segmentsForEntry returns ['show_intro', 'song_intro', 'show_outro']
    // 6. Segment inserts
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-1' }] }); // show_intro
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-2' }] }); // song_intro
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'seg-3' }] }); // show_outro

    // 7. TTS pass updates (3 segments)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update seg-1
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update seg-2
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update seg-3

    // 8. Final script update
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // 9. Build manifest mocks (auto-triggered at end of job)
    // 9a. Get script + company
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: scriptId, playlist_id: 'play-1', station_id: 'station-1', company_id: 'company-1' }],
    });
    // 9b. Get segments
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'seg-1', playlist_entry_id: 'entry-1', segment_type: 'show_intro', audio_url: '/a.mp3', audio_duration_sec: 10 }
      ],
    });
    // 9c. Get entries
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'entry-1', title: 'S1', artist: 'A1', duration_sec: 180 }],
    });
    // 9d. Insert manifest
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'man-1' }],
    });

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
});
