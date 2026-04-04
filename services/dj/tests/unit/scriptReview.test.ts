/**
 * Unit tests for script review flow (issue #30)
 * Tests: approveScript, rejectScript, saveSegmentEdit, approveSegment, regenerateSegment
 * Also tests: generation worker skips TTS when auto_approve = false
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB ─────────────────────────────────────────────────────────────────
const mockQuery = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn(() => ({
    query: mockQuery,
    on: vi.fn(),
  })),
}));

// ─── Mock LLM ────────────────────────────────────────────────────────────────
vi.mock('../../src/adapters/llm/openrouter.js', () => ({
  llmComplete: vi.fn().mockResolvedValue('Rewritten segment text'),
}));

// ─── Mock TTS ────────────────────────────────────────────────────────────────
const mockGenerateSegmentTts = vi.fn().mockResolvedValue({
  audio_url: '/dj/audio/script1/0.mp3',
  audio_duration_sec: 3.5,
});
const mockGenerateScriptAudio = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/ttsService.js', () => ({
  generateSegmentTts: mockGenerateSegmentTts,
  generateScriptAudio: mockGenerateScriptAudio,
  loadTtsProviderConfig: vi.fn().mockResolvedValue({
    provider: 'openai',
    apiKey: 'test-key',
    voiceId: 'alloy',
  }),
}));

vi.mock('../../src/services/manifestService.js', () => ({
  buildManifest: vi.fn().mockResolvedValue(undefined),
  getManifestByScript: vi.fn(),
}));

vi.mock('../../src/queues/djQueue.js', () => ({
  enqueueDjGeneration: vi.fn().mockResolvedValue('job-123'),
}));

vi.mock('../../src/config.js', () => ({
  config: {
    tts: { openaiApiKey: 'test', elevenlabsApiKey: 'test', provider: 'openai' },
    storage: { localPath: '/tmp/playgen-dj' },
    openRouter: { defaultModel: 'test-model', apiKey: 'test' },
    redis: { host: 'localhost', port: 6379 },
  },
}));

vi.mock('../../src/lib/storage/index.js', () => ({
  getStorageAdapter: vi.fn(() => ({ read: vi.fn(), write: vi.fn() })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockScript(overrides = {}) {
  return {
    id: 'script-1',
    playlist_id: 'playlist-1',
    station_id: 'station-1',
    dj_profile_id: 'profile-1',
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    llm_model: 'test-model',
    total_segments: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockSegment(overrides = {}) {
  return {
    id: 'seg-1',
    script_id: 'script-1',
    playlist_entry_id: 'entry-1',
    segment_type: 'song_intro',
    position: 0,
    script_text: 'Original text',
    edited_text: null,
    segment_review_status: 'pending',
    audio_url: null,
    audio_duration_sec: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('scriptService — approveScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates review_status to approved and returns the script', async () => {
    const approved = mockScript({ review_status: 'approved', reviewed_by: 'user-1' });
    mockQuery.mockResolvedValueOnce({ rows: [approved] });

    const { approveScript } = await import('../../src/services/scriptService.js');
    const result = await approveScript('script-1', 'user-1', 'Looks good');

    expect(result).not.toBeNull();
    expect(result?.review_status).toBe('approved');
    expect(mockQuery).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("review_status = 'approved'");
    expect(sql).toContain("review_status = 'pending_review'"); // WHERE guard
  });

  it('returns null when script is not in pending_review state', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { approveScript } = await import('../../src/services/scriptService.js');
    const result = await approveScript('script-1', 'user-1');
    expect(result).toBeNull();
  });
});

describe('scriptService — rejectScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates review_status to rejected with notes', async () => {
    const rejected = mockScript({ review_status: 'rejected', review_notes: 'Too bland' });
    mockQuery.mockResolvedValueOnce({ rows: [rejected] });

    const { rejectScript } = await import('../../src/services/scriptService.js');
    const result = await rejectScript('script-1', 'user-1', 'Too bland');

    expect(result?.review_status).toBe('rejected');
    expect(result?.review_notes).toBe('Too bland');
  });

  it('returns null when script is already in a final non-rejectable state', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { rejectScript } = await import('../../src/services/scriptService.js');
    const result = await rejectScript('script-1', 'user-1', 'Bad');
    expect(result).toBeNull();
  });
});

describe('scriptService — saveSegmentEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves edited text and marks segment as edited', async () => {
    const updated = mockSegment({ edited_text: 'New text', segment_review_status: 'edited' });
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const { saveSegmentEdit } = await import('../../src/services/scriptService.js');
    const result = await saveSegmentEdit('seg-1', 'New text');

    expect(result?.edited_text).toBe('New text');
    expect(result?.segment_review_status).toBe('edited');
  });

  it('returns null when segment is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { saveSegmentEdit } = await import('../../src/services/scriptService.js');
    const result = await saveSegmentEdit('nonexistent', 'text');
    expect(result).toBeNull();
  });
});

describe('scriptService — approveSegment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks segment as approved', async () => {
    const approved = mockSegment({ segment_review_status: 'approved' });
    mockQuery.mockResolvedValueOnce({ rows: [approved] });

    const { approveSegment } = await import('../../src/services/scriptService.js');
    const result = await approveSegment('seg-1');

    expect(result?.segment_review_status).toBe('approved');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("segment_review_status = 'approved'");
  });
});

describe('scriptService — regenerateSegment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches context, calls LLM, and saves new script_text', async () => {
    // Query 1: load segment with context
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'seg-1', script_id: 'script-1', segment_type: 'song_intro',
        position: 0, playlist_entry_id: 'entry-1',
        playlist_id: 'playlist-1', station_id: 'station-1',
        station_name: 'Test FM', station_timezone: 'UTC',
      }],
    });
    // Query 2: load DJ profile
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'profile-1', name: 'Alex', personality: 'Energetic DJ',
        voice_style: 'upbeat', llm_model: 'test-model', llm_temperature: 0.8,
        tts_provider: 'openai', tts_voice_id: 'alloy',
        is_default: true, is_active: true,
        persona_config: {},
      }],
    });
    // Query 3: load playlist entries
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'entry-1', hour: 8, position: 0, song_title: 'Song A', song_artist: 'Artist A', duration_sec: 180 },
        { id: 'entry-2', hour: 8, position: 1, song_title: 'Song B', song_artist: 'Artist B', duration_sec: 200 },
      ],
    });
    // Query 4: update segment with new text
    mockQuery.mockResolvedValueOnce({
      rows: [mockSegment({ script_text: 'Rewritten segment text', segment_review_status: 'pending' })],
    });

    const { regenerateSegment } = await import('../../src/services/scriptService.js');
    const result = await regenerateSegment('seg-1', 'Too short');

    expect(result).not.toBeNull();
    expect(result?.script_text).toBe('Rewritten segment text');
    expect(result?.segment_review_status).toBe('pending');
  });

  it('returns null when segment is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { regenerateSegment } = await import('../../src/services/scriptService.js');
    const result = await regenerateSegment('nonexistent');
    expect(result).toBeNull();
  });
});

describe('generation worker — TTS gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips TTS when auto_approve is false', async () => {
    // Setup: station, station_settings, profile, entries, script insert, segment insert, script update
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'station-1', name: 'Test FM', timezone: 'UTC', company_id: 'company-1' }] }) // station
      .mockResolvedValueOnce({ rows: [] }) // station settings
      .mockResolvedValueOnce({ rows: [{ id: 'profile-1', name: 'Alex', personality: 'DJ', voice_style: 'upbeat', llm_model: 'test-model', llm_temperature: 0.8, tts_provider: 'openai', tts_voice_id: 'alloy', is_default: true, is_active: true, persona_config: {}, company_id: 'company-1' }] }) // profile
      .mockResolvedValueOnce({ rows: [{ id: 'entry-1', hour: 8, position: 0, song_title: 'Song A', song_artist: 'Artist A', duration_sec: 180 }] }) // entries
      .mockResolvedValueOnce({ rows: [] }) // templates
      .mockResolvedValueOnce({ rows: [{ id: 'script-1' }] }) // script insert
      .mockResolvedValueOnce({ rows: [{ id: 'seg-1' }] }) // show_intro insert
      .mockResolvedValueOnce({ rows: [{ id: 'seg-2' }] }) // song_intro insert
      .mockResolvedValueOnce({ rows: [{ id: 'seg-3' }] }) // show_outro insert
      .mockResolvedValueOnce({ rows: [] }); // script update

    const { runGenerationJob } = await import('../../src/workers/generationWorker.js');
    await runGenerationJob({
      playlist_id: 'playlist-1',
      station_id: 'station-1',
      dj_profile_id: 'profile-1',
      auto_approve: false,
    });

    // TTS should NOT have been called
    expect(mockGenerateSegmentTts).not.toHaveBeenCalled();
  });

  it('runs TTS when auto_approve is true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'station-1', name: 'Test FM', timezone: 'UTC', company_id: 'company-1' }] })
      .mockResolvedValueOnce({ rows: [{ key: 'tts_api_key', value: 'test-key' }, { key: 'tts_provider', value: 'openai' }] }) // settings with API key
      .mockResolvedValueOnce({ rows: [{ id: 'profile-1', name: 'Alex', personality: 'DJ', voice_style: 'upbeat', llm_model: 'test-model', llm_temperature: 0.8, tts_provider: 'openai', tts_voice_id: 'alloy', is_default: true, is_active: true, persona_config: {}, company_id: 'company-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'entry-1', hour: 8, position: 0, song_title: 'Song A', song_artist: 'Artist A', duration_sec: 180 }] })
      .mockResolvedValueOnce({ rows: [] }) // templates
      .mockResolvedValueOnce({ rows: [{ id: 'script-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'seg-1' }] }) // show_intro
      .mockResolvedValueOnce({ rows: [{ id: 'seg-2' }] }) // song_intro
      .mockResolvedValueOnce({ rows: [{ id: 'seg-3' }] }) // show_outro
      .mockResolvedValueOnce({ rows: [] }); // script update

    const { runGenerationJob } = await import('../../src/workers/generationWorker.js');
    await runGenerationJob({
      playlist_id: 'playlist-1',
      station_id: 'station-1',
      dj_profile_id: 'profile-1',
      auto_approve: true,
    });

    // TTS SHOULD have been called for each segment
    expect(mockGenerateSegmentTts).toHaveBeenCalledTimes(3);
  });
});
