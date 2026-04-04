import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('manifestService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('interleaves songs and segments correctly', async () => {
    const mockQuery = vi.fn();
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    const mockGetUrl = vi.fn((path) => `/api/v1/dj/audio/${path}`);

    // Mock dependencies using doMock to avoid hoisting issues with relative paths
    vi.doMock('../../src/db', () => ({
      getPool: () => ({
        query: mockQuery,
      }),
    }));

    vi.doMock('../../src/lib/storage/index', () => ({
      getStorageAdapter: () => ({
        write: mockWrite,
        getPublicUrl: mockGetUrl,
      }),
    }));

    // Import the service AFTER mocking
    const { buildManifest } = await import('../../src/services/manifestService');

    const scriptId = 'script-1';

    // 1. Mock script/station query
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: scriptId, playlist_id: 'play-1', station_id: 'sta-1', company_id: 'comp-1' }],
    });

    // 2. Mock segments query
    mockQuery.mockResolvedValueOnce({
      rows: [
        { 
          id: 'seg-1', 
          playlist_entry_id: 'entry-1', 
          segment_type: 'show_intro', 
          audio_url: '/api/v1/dj/audio/1.mp3', 
          audio_duration_sec: 10 
        },
        { 
          id: 'seg-2', 
          playlist_entry_id: 'entry-1', 
          segment_type: 'song_intro', 
          audio_url: '/api/v1/dj/audio/2.mp3', 
          audio_duration_sec: 15 
        },
        { 
          id: 'seg-3', 
          playlist_entry_id: 'entry-2', 
          segment_type: 'show_outro', 
          audio_url: '/api/v1/dj/audio/3.mp3', 
          audio_duration_sec: 5 
        },
      ],
    });

    // 3. Mock entries query
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'entry-1', title: 'Song 1', artist: 'Artist 1', duration_sec: 180 },
        { id: 'entry-2', title: 'Song 2', artist: 'Artist 2', duration_sec: 200 },
      ],
    });

    // 4. Mock manifest insert
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'man-1' }],
    });

    const result = await buildManifest(scriptId);

    expect(result).toBe('man-1');
    expect(mockWrite).toHaveBeenCalled();
    
    const writtenJson = JSON.parse(mockWrite.mock.calls[0][1].toString());
    expect(writtenJson).toHaveLength(5);
    expect(writtenJson[0].type).toBe('dj_segment');
    expect(writtenJson[2].type).toBe('song');
    expect(writtenJson[4].id).toBe('seg-3');
  });
});
