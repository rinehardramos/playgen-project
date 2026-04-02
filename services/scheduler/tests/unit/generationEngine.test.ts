/**
 * Unit tests for the rotation-rule filtering logic used in generationEngine.ts.
 *
 * Because the production generatePlaylist() function is tightly coupled to a
 * PostgreSQL pool, the filtering and selection algorithms are re-implemented
 * here as pure functions mirroring the production logic exactly. This lets us
 * exercise every decision branch without a database.
 *
 * If the production helpers are ever extracted and exported, these tests can
 * be updated to import them directly.
 */

import { describe, it, expect } from 'vitest';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  artist: string;
}

interface HistoryEntry {
  song_id: string;
  played_at: Date;
}

interface PlacedEntry {
  hour: number;
  position: number;
  artist: string;
}

// ─── Pure helper functions (mirror generationEngine.ts logic) ─────────────────

/**
 * Exclude songs played within the last minGapHours from recentHistory.
 */
function filterByGap(
  candidates: Candidate[],
  recentHistory: HistoryEntry[],
  minGapHours: number,
): Candidate[] {
  const now = Date.now();
  const minGapMs = minGapHours * 60 * 60 * 1000;

  return candidates.filter((song) => {
    const lastPlay = recentHistory
      .filter((h) => h.song_id === song.id)
      .sort((a, b) => b.played_at.getTime() - a.played_at.getTime())[0];

    if (!lastPlay) return true; // never played → always eligible
    return now - lastPlay.played_at.getTime() >= minGapMs;
  });
}

/**
 * Exclude songs that have already reached maxPlaysPerDay for today.
 */
function filterByDayLimit(
  candidates: Candidate[],
  todayPlays: Map<string, number>,
  maxPlaysPerDay: number,
): Candidate[] {
  return candidates.filter((song) => {
    const plays = todayPlays.get(song.id) ?? 0;
    return plays < maxPlaysPerDay;
  });
}

/**
 * Exclude songs whose artist appeared within the last artistSeparationSlots
 * positions in the placed entries list (treats placedEntries as ordered).
 */
function filterByArtistSeparation(
  candidates: Candidate[],
  placedEntries: PlacedEntry[],
  _currentHour: number,
  _currentPosition: number,
  artistSeparationSlots: number,
): Candidate[] {
  const currentAbsolutePosition = placedEntries.length;
  const separationStart = Math.max(0, currentAbsolutePosition - artistSeparationSlots);
  const nearbyArtists = new Set(
    placedEntries.slice(separationStart).map((e) => e.artist.toLowerCase()),
  );

  return candidates.filter((song) => !nearbyArtists.has(song.artist.toLowerCase()));
}

/**
 * Exclude songs whose artist already has maxSameArtistPerHour or more
 * placements in currentHour.
 */
function filterByMaxArtistPerHour(
  candidates: Candidate[],
  placedEntries: PlacedEntry[],
  currentHour: number,
  maxSameArtistPerHour: number,
): Candidate[] {
  return candidates.filter((song) => {
    const sameArtistThisHour = placedEntries.filter(
      (e) =>
        e.hour === currentHour &&
        e.artist.toLowerCase() === song.artist.toLowerCase(),
    ).length;
    return sameArtistThisHour < maxSameArtistPerHour;
  });
}

/**
 * From a list of candidates, return the one least recently played.
 * Songs with no history take priority (returned randomly among them via
 * deterministic first-item selection for testability).
 * When multiple songs share the oldest play time, return the one whose id
 * comes first alphabetically (for determinism in tests).
 */
function pickLeastRecentlyPlayed(
  candidates: Candidate[],
  playHistory: Map<string, Date>,
): Candidate | null {
  if (candidates.length === 0) return null;

  const withoutHistory: Candidate[] = [];
  const withHistory: Array<{ candidate: Candidate; lastPlayed: Date }> = [];

  for (const c of candidates) {
    const lp = playHistory.get(c.id);
    if (lp === undefined) {
      withoutHistory.push(c);
    } else {
      withHistory.push({ candidate: c, lastPlayed: lp });
    }
  }

  // Never-played songs take priority
  if (withoutHistory.length > 0) {
    // Return first alphabetically for determinism
    return withoutHistory.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
  }

  // Find the oldest play date
  withHistory.sort((a, b) => {
    const timeDiff = a.lastPlayed.getTime() - b.lastPlayed.getTime();
    if (timeDiff !== 0) return timeDiff; // ascending — oldest first
    return a.candidate.id.localeCompare(b.candidate.id); // tie-break by id
  });

  return withHistory[0].candidate;
}

// ─── Helpers for building test data ──────────────────────────────────────────

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

const songA: Candidate = { id: 'song-a', artist: 'Artist Alpha' };
const songB: Candidate = { id: 'song-b', artist: 'Artist Beta' };
const songC: Candidate = { id: 'song-c', artist: 'Artist Gamma' };
const songD: Candidate = { id: 'song-d', artist: 'Artist Alpha' }; // same artist as A

// ─── filterByGap ─────────────────────────────────────────────────────────────

describe('filterByGap', () => {
  it('excludes a song played 1 hour ago when minGapHours=3', () => {
    const history: HistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(1) },
    ];
    const result = filterByGap([songA, songB], history, 3);
    expect(result.map((s) => s.id)).not.toContain(songA.id);
    expect(result.map((s) => s.id)).toContain(songB.id);
  });

  it('includes a song played 4 hours ago when minGapHours=3', () => {
    const history: HistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(4) },
    ];
    const result = filterByGap([songA, songB], history, 3);
    expect(result.map((s) => s.id)).toContain(songA.id);
  });

  it('includes a song with no play history at all', () => {
    const result = filterByGap([songA, songB], [], 3);
    expect(result).toHaveLength(2);
  });

  it('uses the most recent play when a song appears multiple times in history', () => {
    const history: HistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(5) }, // old play
      { song_id: songA.id, played_at: hoursAgo(1) }, // recent play — this should block it
    ];
    const result = filterByGap([songA], history, 3);
    expect(result).toHaveLength(0);
  });

  it('song played exactly at the gap boundary (elapsed === minGapMs) is included', () => {
    // Subtract a couple of ms to ensure it's just at or past the boundary
    const playedAt = new Date(Date.now() - 3 * 60 * 60 * 1000 - 100);
    const history: HistoryEntry[] = [{ song_id: songA.id, played_at: playedAt }];
    const result = filterByGap([songA], history, 3);
    expect(result).toHaveLength(1);
  });

  it('all candidates excluded when all were played recently', () => {
    const history: HistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(0.5) },
      { song_id: songB.id, played_at: hoursAgo(1) },
    ];
    const result = filterByGap([songA, songB], history, 3);
    expect(result).toHaveLength(0);
  });
});

// ─── filterByDayLimit ─────────────────────────────────────────────────────────

describe('filterByDayLimit', () => {
  it('excludes song played exactly maxPlaysPerDay times today', () => {
    const todayPlays = new Map([['song-a', 2]]);
    const result = filterByDayLimit([songA, songB], todayPlays, 2);
    expect(result.map((s) => s.id)).not.toContain(songA.id);
    expect(result.map((s) => s.id)).toContain(songB.id);
  });

  it('includes song played one less than maxPlaysPerDay times today', () => {
    const todayPlays = new Map([['song-a', 1]]);
    const result = filterByDayLimit([songA], todayPlays, 2);
    expect(result.map((s) => s.id)).toContain(songA.id);
  });

  it('includes song with no entry in todayPlays map', () => {
    const result = filterByDayLimit([songA, songB], new Map(), 1);
    expect(result).toHaveLength(2);
  });

  it('excludes song played more times than maxPlaysPerDay', () => {
    const todayPlays = new Map([['song-a', 5]]);
    const result = filterByDayLimit([songA], todayPlays, 1);
    expect(result).toHaveLength(0);
  });

  it('handles maxPlaysPerDay=1 (default rule) correctly', () => {
    const todayPlays = new Map<string, number>([['song-a', 1], ['song-b', 0]]);
    const result = filterByDayLimit([songA, songB], todayPlays, 1);
    expect(result.map((s) => s.id)).toEqual(['song-b']);
  });
});

// ─── filterByArtistSeparation ─────────────────────────────────────────────────

describe('filterByArtistSeparation', () => {
  it('excludes song whose artist was placed 1 slot ago when separation=2', () => {
    const placed: PlacedEntry[] = [
      { hour: 4, position: 0, artist: 'Artist Alpha' },
    ];
    // songA and songD share artist 'Artist Alpha'
    const result = filterByArtistSeparation([songA, songB], placed, 4, 1, 2);
    expect(result.map((s) => s.id)).not.toContain(songA.id);
    expect(result.map((s) => s.id)).toContain(songB.id);
  });

  it('includes song whose artist was placed exactly separation+1 slots ago', () => {
    const placed: PlacedEntry[] = [
      { hour: 4, position: 0, artist: 'Artist Alpha' },
      { hour: 4, position: 1, artist: 'Artist Beta' },
      { hour: 4, position: 2, artist: 'Artist Gamma' },
    ];
    // With separation=2, we look back 2 slots from index 3: positions [1,2] → Beta, Gamma
    // Alpha is at slot 0 → outside the window → should be included
    const result = filterByArtistSeparation([songA], placed, 4, 3, 2);
    expect(result.map((s) => s.id)).toContain(songA.id);
  });

  it('different artist always passes the separation filter', () => {
    const placed: PlacedEntry[] = [
      { hour: 4, position: 0, artist: 'Artist Alpha' },
      { hour: 4, position: 1, artist: 'Artist Alpha' },
    ];
    const result = filterByArtistSeparation([songB, songC], placed, 4, 2, 4);
    expect(result).toHaveLength(2);
  });

  it('case-insensitive artist comparison', () => {
    const placed: PlacedEntry[] = [
      { hour: 4, position: 0, artist: 'ARTIST ALPHA' },
    ];
    const result = filterByArtistSeparation([songA], placed, 4, 1, 2);
    // 'Artist Alpha' should match 'ARTIST ALPHA'
    expect(result).toHaveLength(0);
  });

  it('empty placedEntries → all candidates pass', () => {
    const result = filterByArtistSeparation([songA, songB, songC], [], 4, 0, 4);
    expect(result).toHaveLength(3);
  });
});

// ─── filterByMaxArtistPerHour ─────────────────────────────────────────────────

describe('filterByMaxArtistPerHour', () => {
  it('excludes a 3rd placement when max=1 and artist already placed twice this hour', () => {
    const placed: PlacedEntry[] = [
      { hour: 4, position: 0, artist: 'Artist Alpha' },
      { hour: 4, position: 1, artist: 'Artist Alpha' },
    ];
    // songA and songD are both 'Artist Alpha'
    const result = filterByMaxArtistPerHour([songA, songD, songB], placed, 4, 1);
    expect(result.map((s) => s.id)).not.toContain(songA.id);
    expect(result.map((s) => s.id)).not.toContain(songD.id);
    expect(result.map((s) => s.id)).toContain(songB.id);
  });

  it('allows a 2nd placement when max=2 and artist placed once this hour', () => {
    const placed: PlacedEntry[] = [
      { hour: 4, position: 0, artist: 'Artist Alpha' },
    ];
    const result = filterByMaxArtistPerHour([songA, songD], placed, 4, 2);
    expect(result).toHaveLength(2);
  });

  it('placements in other hours do NOT count toward the per-hour limit', () => {
    const placed: PlacedEntry[] = [
      { hour: 3, position: 0, artist: 'Artist Alpha' }, // different hour
      { hour: 3, position: 1, artist: 'Artist Alpha' }, // different hour
    ];
    const result = filterByMaxArtistPerHour([songA], placed, 4, 1);
    expect(result).toHaveLength(1);
  });

  it('case-insensitive comparison for artist names', () => {
    const placed: PlacedEntry[] = [
      { hour: 5, position: 0, artist: 'artist beta' },
    ];
    const result = filterByMaxArtistPerHour(
      [{ id: 'song-b2', artist: 'Artist Beta' }],
      placed,
      5,
      1,
    );
    expect(result).toHaveLength(0);
  });

  it('allows first placement for an artist with no prior slots this hour', () => {
    const placed: PlacedEntry[] = [
      { hour: 4, position: 0, artist: 'Artist Beta' },
    ];
    const result = filterByMaxArtistPerHour([songA], placed, 4, 1);
    expect(result).toHaveLength(1);
  });
});

// ─── pickLeastRecentlyPlayed ──────────────────────────────────────────────────

describe('pickLeastRecentlyPlayed', () => {
  it('returns null when candidates array is empty', () => {
    expect(pickLeastRecentlyPlayed([], new Map())).toBeNull();
  });

  it('returns the song with the oldest last_played date', () => {
    const playHistory = new Map<string, Date>([
      ['song-a', daysAgo(3)],
      ['song-b', daysAgo(1)],
      ['song-c', daysAgo(5)], // oldest
    ]);
    const result = pickLeastRecentlyPlayed([songA, songB, songC], playHistory);
    expect(result?.id).toBe('song-c');
  });

  it('returns a song with no history (never played) over one with history', () => {
    const playHistory = new Map<string, Date>([
      ['song-a', daysAgo(10)], // played a long time ago
    ]);
    // songB has no history entry → should take priority
    const result = pickLeastRecentlyPlayed([songA, songB], playHistory);
    expect(result?.id).toBe('song-b');
  });

  it('returns first alphabetically by id when two songs tie on last_played', () => {
    const sharedDate = daysAgo(3);
    const playHistory = new Map<string, Date>([
      ['song-a', sharedDate],
      ['song-b', sharedDate],
    ]);
    const result = pickLeastRecentlyPlayed([songA, songB], playHistory);
    // 'song-a' < 'song-b' alphabetically
    expect(result?.id).toBe('song-a');
  });

  it('returns first alphabetically among multiple never-played songs', () => {
    // Neither 'song-b' nor 'song-c' is in playHistory
    const result = pickLeastRecentlyPlayed([songC, songB], new Map());
    // 'song-b' < 'song-c'
    expect(result?.id).toBe('song-b');
  });

  it('returns the only candidate when candidates has a single entry', () => {
    const playHistory = new Map<string, Date>([['song-a', daysAgo(2)]]);
    const result = pickLeastRecentlyPlayed([songA], playHistory);
    expect(result?.id).toBe('song-a');
  });

  it('prioritises multiple never-played songs over all songs with history', () => {
    const playHistory = new Map<string, Date>([
      ['song-a', daysAgo(365)], // very old play
    ]);
    // songB and songC have no history
    const result = pickLeastRecentlyPlayed([songA, songB, songC], playHistory);
    // Should pick from {songB, songC} — never-played pool
    expect(['song-b', 'song-c']).toContain(result?.id);
  });
});
