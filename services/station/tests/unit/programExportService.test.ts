import { describe, it, expect, vi, beforeEach } from 'vitest';

// DB is mocked — pure unit tests
const mockQuery = vi.fn();
vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

// Mock fs/promises to avoid disk I/O
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  },
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

import { exportEpisode } from '../../src/services/programExportService';

describe('programExportService — exportEpisode', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('throws NOT_FOUND error when episode does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // episode query

    await expect(exportEpisode('non-existent-id')).rejects.toMatchObject({
      message: 'Episode not found',
      code: 'NOT_FOUND',
    });
  });

  it('builds a ZIP buffer when episode exists with no playlist', async () => {
    // episode+program query
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'ep-1',
        air_date: '2026-04-22',
        status: 'draft',
        notes: null,
        episode_title: null,
        playlist_id: null,
        dj_script_id: null,
        manifest_id: null,
        program_id: 'prog-1',
        program_name: 'Morning Drive',
        program_description: null,
        program_active_days: ['mon', 'tue'],
        start_hour: 6,
        end_hour: 10,
        program_color_tag: null,
      }],
    });

    const buffer = await exportEpisode('ep-1');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // ZIP magic bytes: PK\x03\x04
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
  });

  it('queries playlist and songs when playlist_id is present', async () => {
    // episode+program query
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'ep-2',
        air_date: '2026-04-23',
        status: 'ready',
        notes: 'test',
        episode_title: null,
        playlist_id: 'pl-1',
        dj_script_id: null,
        manifest_id: null,
        program_id: 'prog-1',
        program_name: 'Evening Show',
        program_description: null,
        program_active_days: ['fri'],
        start_hour: 19,
        end_hour: 22,
        program_color_tag: '#ff0000',
      }],
    });
    // playlist query
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pl-1', date: '2026-04-23', status: 'approved' }] });
    // playlist entries query
    mockQuery.mockResolvedValueOnce({
      rows: [
        { hour: 19, position: 1, title: 'Test Song', artist: 'Test Artist', duration_sec: 240, category_code: 'AC', category_label: 'Adult Contemporary' },
      ],
    });

    const buffer = await exportEpisode('ep-2');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // Verify playlist was queried
    const playlistCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('FROM playlists'));
    expect(playlistCall).toBeTruthy();
    // Verify song entries were queried
    const songsCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('playlist_entries'));
    expect(songsCall).toBeTruthy();
  });
});
