import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('manifestService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('interleaves songs and segments correctly with ms timing', async () => {
    const mockQuery = vi.fn();
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    const mockGetUrl = vi.fn((path) => `/api/v1/dj/audio/${path}`);

    vi.doMock('../../src/db', () => ({
      getPool: () => ({ query: mockQuery }),
    }));

    vi.doMock('../../src/lib/storage/index', () => ({
      getStorageAdapter: () => ({
        write: mockWrite,
        getPublicUrl: mockGetUrl,
      }),
    }));

    const { buildManifest } = await import('../../src/services/manifestService');

    const scriptId = 'script-1';

    // 1. Script/station
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: scriptId, playlist_id: 'play-1', station_id: 'sta-1', company_id: 'comp-1' }],
    });

    // 2. Segments
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'seg-1',
          playlist_entry_id: 'entry-1',
          segment_type: 'show_intro',
          audio_url: '/api/v1/dj/audio/1.mp3',
          audio_duration_sec: 10,
        },
        {
          id: 'seg-2',
          playlist_entry_id: 'entry-1',
          segment_type: 'song_intro',
          audio_url: '/api/v1/dj/audio/2.mp3',
          audio_duration_sec: 15,
        },
        {
          id: 'seg-3',
          playlist_entry_id: 'entry-2',
          segment_type: 'show_outro',
          audio_url: '/api/v1/dj/audio/3.mp3',
          audio_duration_sec: 5,
        },
      ],
    });

    // 3. Playlist entries (with hour + position)
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'entry-1', hour: 8, position: 0, title: 'Song 1', artist: 'Artist 1', duration_sec: 180 },
        { id: 'entry-2', hour: 8, position: 1, title: 'Song 2', artist: 'Artist 2', duration_sec: 200 },
      ],
    });

    // 4. Manifest insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'man-1' }] });

    const result = await buildManifest(scriptId);

    expect(result).toBe('man-1');
    expect(mockWrite).toHaveBeenCalled();

    const written = JSON.parse(mockWrite.mock.calls[0][1].toString());

    // Structure: { total_duration_ms, items }
    expect(written).toHaveProperty('total_duration_ms');
    expect(written).toHaveProperty('items');

    const items = written.items;
    expect(items).toHaveLength(5); // seg-1, seg-2, song-1, song-2, seg-3

    // First item: show_intro segment
    expect(items[0].type).toBe('dj_segment');
    expect(items[0].id).toBe('seg-1');
    expect(items[0].duration_ms).toBe(10000);
    expect(items[0].cumulative_ms).toBe(0);
    expect(items[0].file_path).toBe('1.mp3');

    // Second item: song_intro segment
    expect(items[1].type).toBe('dj_segment');
    expect(items[1].cumulative_ms).toBe(10000);
    expect(items[1].duration_ms).toBe(15000);

    // Third item: Song 1
    expect(items[2].type).toBe('song');
    expect(items[2].hour).toBe(8);
    expect(items[2].position).toBe(0);
    expect(items[2].artist).toBe('Artist 1');
    expect(items[2].duration_ms).toBe(180000);
    expect(items[2].cumulative_ms).toBe(25000); // 10000 + 15000

    // Fourth item: Song 2 (no segments before it)
    expect(items[3].type).toBe('song');
    expect(items[3].cumulative_ms).toBe(205000); // 25000 + 180000

    // Fifth item: show_outro
    expect(items[4].type).toBe('dj_segment');
    expect(items[4].id).toBe('seg-3');
    expect(items[4].cumulative_ms).toBe(405000); // 205000 + 200000

    // Total duration
    expect(written.total_duration_ms).toBe(410000); // 405000 + 5000
  });

  it('handles entries without audio segments', async () => {
    const mockQuery = vi.fn();
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    const mockGetUrl = vi.fn((path) => `/api/v1/dj/audio/${path}`);

    vi.doMock('../../src/db', () => ({
      getPool: () => ({ query: mockQuery }),
    }));

    vi.doMock('../../src/lib/storage/index', () => ({
      getStorageAdapter: () => ({
        write: mockWrite,
        getPublicUrl: mockGetUrl,
      }),
    }));

    const { buildManifest } = await import('../../src/services/manifestService');

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'script-2', playlist_id: 'play-2', station_id: 'sta-1', company_id: 'comp-1' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no segments
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'entry-1', hour: 9, position: 0, title: 'Song A', artist: 'Artist A', duration_sec: 240 },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'man-2' }] });

    await buildManifest('script-2');

    const written = JSON.parse(mockWrite.mock.calls[0][1].toString());
    expect(written.items).toHaveLength(1);
    expect(written.items[0].type).toBe('song');
    expect(written.items[0].duration_ms).toBe(240000);
    expect(written.total_duration_ms).toBe(240000);
  });
});
