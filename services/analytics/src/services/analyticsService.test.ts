import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getRotationHeatmap,
  getOverplayedSongs,
  getUnderplayedSongs,
  getCategoryDistribution,
  getSongHistory,
} from './analyticsService';

const mockQuery = vi.fn();
vi.mock('../db', () => ({ getPool: () => ({ query: mockQuery }) }));

beforeEach(() => {
  mockQuery.mockReset();
});

describe('getRotationHeatmap', () => {
  it('aggregates multiple rows for the same song into a single entry with a plays map', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { song_id: 's1', title: 'Track One', artist: 'Artist A', category_code: 'POP', play_date: '2026-03-28', play_count: 3 },
        { song_id: 's1', title: 'Track One', artist: 'Artist A', category_code: 'POP', play_date: '2026-03-29', play_count: 2 },
        { song_id: 's2', title: 'Track Two', artist: 'Artist B', category_code: 'RNB', play_date: '2026-03-28', play_count: 1 },
      ],
    });

    const result = await getRotationHeatmap('station-1', 14);

    expect(result).toHaveLength(2);

    const songOne = result.find(r => r.song_id === 's1');
    expect(songOne).toBeDefined();
    expect(songOne!.plays).toEqual({ '2026-03-28': 3, '2026-03-29': 2 });
    expect(songOne!.title).toBe('Track One');
    expect(songOne!.category_code).toBe('POP');

    const songTwo = result.find(r => r.song_id === 's2');
    expect(songTwo).toBeDefined();
    expect(songTwo!.plays).toEqual({ '2026-03-28': 1 });
  });

  it('returns an empty array when there are no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getRotationHeatmap('station-1', 14);

    expect(result).toEqual([]);
  });
});

describe('getOverplayedSongs', () => {
  it('returns songs with avg_plays_per_day above the threshold and attaches the threshold to each row', async () => {
    // First call: getMaxPlaysPerDay (rotation_rules)
    mockQuery.mockResolvedValueOnce({
      rows: [{ rules: { max_plays_per_day: 3 } }],
    });
    // Second call: overplayed songs query
    mockQuery.mockResolvedValueOnce({
      rows: [
        { song_id: 's1', title: 'Hot Song', artist: 'Artist A', category_code: 'POP', avg_plays_per_day: '4.50' },
      ],
    });

    const result = await getOverplayedSongs('station-1');

    expect(result).toHaveLength(1);
    expect(result[0].song_id).toBe('s1');
    expect(result[0].avg_plays_per_day).toBe(4.5);
    expect(result[0].threshold).toBe(3);
  });

  it('uses a fallback threshold of 2 when rotation_rules has no max_plays_per_day', async () => {
    // First call: no rules row
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Second call: no overplayed songs
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getOverplayedSongs('station-1');

    expect(result).toEqual([]);
    // Verify the second query used threshold=2
    const secondCallArgs = mockQuery.mock.calls[1];
    expect(secondCallArgs[1]).toContain(2);
  });
});

describe('getUnderplayedSongs', () => {
  it('returns songs with total_plays under 3', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          song_id: 's3',
          title: 'Rare Track',
          artist: 'Artist C',
          category_code: 'FOLK',
          total_plays: 1,
          last_played_at: new Date('2026-03-20T12:00:00.000Z'),
        },
        {
          song_id: 's4',
          title: 'Never Played',
          artist: 'Artist D',
          category_code: 'JAZZ',
          total_plays: 0,
          last_played_at: null,
        },
      ],
    });

    const result = await getUnderplayedSongs('station-1');

    expect(result).toHaveLength(2);
    expect(result[0].total_plays).toBe(1);
    expect(result[1].total_plays).toBe(0);
  });

  it('converts last_played_at Date to an ISO string', async () => {
    const date = new Date('2026-03-20T12:00:00.000Z');
    mockQuery.mockResolvedValueOnce({
      rows: [
        { song_id: 's3', title: 'Rare Track', artist: 'Artist C', category_code: 'FOLK', total_plays: 1, last_played_at: date },
      ],
    });

    const result = await getUnderplayedSongs('station-1');

    expect(result[0].last_played_at).toBe(date.toISOString());
  });

  it('returns null for last_played_at when the value is null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { song_id: 's4', title: 'Never Played', artist: 'Artist D', category_code: 'JAZZ', total_plays: 0, last_played_at: null },
      ],
    });

    const result = await getUnderplayedSongs('station-1');

    expect(result[0].last_played_at).toBeNull();
  });
});

describe('getCategoryDistribution', () => {
  it('returns category distribution with percentage as a number (not a string)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { category_code: 'POP', category_label: 'Pop Music', total_plays: 80, percentage: '57.14' },
        { category_code: 'RNB', category_label: 'R&B', total_plays: 60, percentage: '42.86' },
      ],
    });

    const result = await getCategoryDistribution('station-1', 7);

    expect(result).toHaveLength(2);

    expect(result[0].category_code).toBe('POP');
    expect(result[0].total_plays).toBe(80);
    expect(typeof result[0].percentage).toBe('number');
    expect(result[0].percentage).toBe(57.14);

    expect(result[1].category_code).toBe('RNB');
    expect(typeof result[1].percentage).toBe('number');
    expect(result[1].percentage).toBe(42.86);
  });

  it('returns an empty array when there are no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getCategoryDistribution('station-1', 7);

    expect(result).toEqual([]);
  });
});

describe('getSongHistory', () => {
  it('returns recent play history for a song', async () => {
    const songId = 'song-123';
    const playedAt = new Date('2026-04-04T10:00:00Z');
    
    mockQuery.mockResolvedValueOnce({
      rows: [
        { played_at: playedAt, playlist_id: 'play-1' },
      ],
    });

    const result = await getSongHistory(songId);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      played_at: playedAt.toISOString(),
      playlist_id: 'play-1',
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE song_id = $1'),
      [songId, 30]
    );
  });
});
