/**
 * Unit tests for the master-library fallback logic in generationEngine.ts.
 *
 * The fallback is: when a station has no songs of its own (including inherited
 * siblings), include songs from is_master_library=TRUE stations instead.
 *
 * These tests mirror the production decision logic as pure functions.
 */

import { describe, it, expect } from 'vitest';

interface Song {
  id: string;
  artist: string;
  category_id: string;
  eligible_hours: number[];
}

/**
 * Mirrors the master-library fallback selection in generationEngine.ts:
 * Returns stationSongs when non-empty, otherwise masterSongs.
 */
function resolveLibraryWithFallback(
  stationSongs: Song[],
  masterSongs: Song[],
): { songs: Song[]; usedFallback: boolean } {
  if (stationSongs.length > 0) {
    return { songs: stationSongs, usedFallback: false };
  }
  return { songs: masterSongs, usedFallback: masterSongs.length > 0 };
}

describe('master library fallback', () => {
  const masterSongs: Song[] = [
    { id: 'master-1', artist: 'Artist A', category_id: 'cat-1', eligible_hours: [] },
    { id: 'master-2', artist: 'Artist B', category_id: 'cat-1', eligible_hours: [8, 12, 18] },
  ];

  it('uses station songs when the station has its own library', () => {
    const stationSongs: Song[] = [
      { id: 'station-1', artist: 'Local Band', category_id: 'cat-1', eligible_hours: [] },
    ];

    const { songs, usedFallback } = resolveLibraryWithFallback(stationSongs, masterSongs);

    expect(usedFallback).toBe(false);
    expect(songs).toHaveLength(1);
    expect(songs[0].id).toBe('station-1');
  });

  it('falls back to master library when station has no songs', () => {
    const { songs, usedFallback } = resolveLibraryWithFallback([], masterSongs);

    expect(usedFallback).toBe(true);
    expect(songs).toHaveLength(2);
    expect(songs.map((s) => s.id)).toContain('master-1');
    expect(songs.map((s) => s.id)).toContain('master-2');
  });

  it('returns empty when station has no songs and no master library exists', () => {
    const { songs, usedFallback } = resolveLibraryWithFallback([], []);

    expect(usedFallback).toBe(false);
    expect(songs).toHaveLength(0);
  });

  it('does not fall back when station songs are present even if master library exists', () => {
    const stationSongs: Song[] = [
      { id: 'station-1', artist: 'Local Band', category_id: 'cat-1', eligible_hours: [] },
      { id: 'station-2', artist: 'Another Band', category_id: 'cat-2', eligible_hours: [6] },
    ];

    const { songs, usedFallback } = resolveLibraryWithFallback(stationSongs, masterSongs);

    expect(usedFallback).toBe(false);
    expect(songs).toHaveLength(2);
    expect(songs.every((s) => s.id.startsWith('station-'))).toBe(true);
  });

  it('master songs with hour restrictions are included for the fallback consumer to filter', () => {
    // The fallback returns raw songs; generation engine applies hour filtering after
    const { songs } = resolveLibraryWithFallback([], masterSongs);

    const hourRestricted = songs.filter((s) => s.eligible_hours.length > 0);
    const unrestricted = songs.filter((s) => s.eligible_hours.length === 0);

    expect(hourRestricted).toHaveLength(1);
    expect(unrestricted).toHaveLength(1);
  });
});
