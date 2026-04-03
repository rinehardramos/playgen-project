import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportPlaylistCsv, exportPlaylistXlsx } from './exportService';
import type { PlaylistWithEntries } from './playlistService';

vi.mock('./playlistService', () => ({ getPlaylist: vi.fn() }));

import { getPlaylist } from './playlistService';

const mockGetPlaylist = vi.mocked(getPlaylist);

const mockPlaylist: PlaylistWithEntries = {
  id: 'playlist-1',
  station_id: 'station-1',
  template_id: null,
  date: '2026-04-03',
  status: 'ready',
  generated_at: null,
  generated_by: null,
  approved_at: null,
  approved_by: null,
  notes: null,
  entries: [
    {
      id: 'e1',
      hour: 8,
      position: 1,
      song_id: 's1',
      song_title: 'Song One',
      song_artist: 'Artist A',
      category_code: 'POP',
      category_label: 'Pop Music',
      category_color_tag: null,
      is_manual_override: false,
      overridden_by: null,
      overridden_at: null,
    },
    {
      id: 'e2',
      hour: 8,
      position: 2,
      song_id: 's2',
      song_title: 'Song, Two',
      song_artist: 'Artist B',
      category_code: 'RNB',
      category_label: 'R&B',
      category_color_tag: null,
      is_manual_override: true,
      overridden_by: 'user-1',
      overridden_at: '2026-04-01',
    },
  ],
};

describe('exportPlaylistCsv', () => {
  beforeEach(() => {
    mockGetPlaylist.mockReset();
  });

  it('returns a CSV string with the correct header row', async () => {
    mockGetPlaylist.mockResolvedValue(mockPlaylist);

    const csv = await exportPlaylistCsv('playlist-1');
    const lines = csv.split('\n');

    expect(lines[0]).toBe('hour,position,category,title,artist,is_override');
  });

  it('contains correct data rows for each entry', async () => {
    mockGetPlaylist.mockResolvedValue(mockPlaylist);

    const csv = await exportPlaylistCsv('playlist-1');
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3); // header + 2 data rows
    expect(lines[1]).toContain('Artist A');
    expect(lines[2]).toContain('Artist B');
  });

  it('properly quotes fields that contain commas', async () => {
    mockGetPlaylist.mockResolvedValue(mockPlaylist);

    const csv = await exportPlaylistCsv('playlist-1');
    const lines = csv.split('\n');

    // "Song, Two" contains a comma and must be quoted
    expect(lines[2]).toContain('"Song, Two"');
  });

  it('formats hours with zero-padding as HH:00', async () => {
    mockGetPlaylist.mockResolvedValue(mockPlaylist);

    const csv = await exportPlaylistCsv('playlist-1');
    const lines = csv.split('\n');

    // hour 8 → "08:00"
    expect(lines[1]).toMatch(/^08:00,/);
    expect(lines[2]).toMatch(/^08:00,/);
  });

  it('renders is_manual_override as "true" or "false" strings', async () => {
    mockGetPlaylist.mockResolvedValue(mockPlaylist);

    const csv = await exportPlaylistCsv('playlist-1');
    const lines = csv.split('\n');

    expect(lines[1]).toMatch(/,false$/);
    expect(lines[2]).toMatch(/,true$/);
  });

  it('throws an error when the playlist is not found', async () => {
    mockGetPlaylist.mockResolvedValue(null);

    await expect(exportPlaylistCsv('missing-id')).rejects.toThrow(
      'Playlist missing-id not found'
    );
  });
});

describe('exportPlaylistXlsx', () => {
  beforeEach(() => {
    mockGetPlaylist.mockReset();
  });

  it('returns a non-empty Buffer', async () => {
    mockGetPlaylist.mockResolvedValue(mockPlaylist);

    const result = await exportPlaylistXlsx('playlist-1');

    expect(result).toBeInstanceOf(Buffer);
    expect((result as Buffer).length).toBeGreaterThan(0);
  });

  it('throws an error when the playlist is not found', async () => {
    mockGetPlaylist.mockResolvedValue(null);

    await expect(exportPlaylistXlsx('missing-id')).rejects.toThrow(
      'Playlist missing-id not found'
    );
  });
});
