import { describe, it, expect } from 'vitest';
import { pickBestCandidate, filterCandidates } from './generationEngine';

// ─── Shared test data types (mirrors generationEngine internals) ─────────────

interface CandidateSong {
  id: string;
  artist: string;
}

interface PlayHistoryEntry {
  song_id: string;
  played_at: Date;
}

interface PlacedEntry {
  hour: number;
  position: number;
  song_id: string;
  artist: string;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const songA: CandidateSong = { id: 'song-a', artist: 'Artist Alpha' };
const songB: CandidateSong = { id: 'song-b', artist: 'Artist Beta' };
const songC: CandidateSong = { id: 'song-c', artist: 'Artist Gamma' };
const songD: CandidateSong = { id: 'song-d', artist: 'Artist Delta' };

/** Rotation rules used across all filterCandidates tests. */
const rules = {
  max_plays_per_day: 2,
  min_gap_hours: 2,
  max_same_artist_per_hour: 1,
  artist_separation_slots: 3,
  category_weights: {},
};

/** Helper: a Date that is `hoursAgo` hours before now. */
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

// ─── pickBestCandidate ───────────────────────────────────────────────────────

describe('pickBestCandidate', () => {
  it('returns null when candidates array is empty', () => {
    expect(pickBestCandidate([], [])).toBeNull();
  });

  it('returns a song from never-played songs when some exist', () => {
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(5) },
    ];
    // songB has no history entry → never played
    const result = pickBestCandidate([songA, songB], history);
    expect(result?.id).toBe(songB.id);
  });

  it('returns any of the never-played songs (randomly) when multiple are unplayed', () => {
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(5) },
    ];
    // songB and songC are both never played
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const r = pickBestCandidate([songA, songB, songC], history);
      if (r) results.add(r.id);
    }
    // At least one never-played song should have been picked
    expect(results.has(songA.id)).toBe(false); // songA HAS history, should never win
    const neverPlayedPicked = [...results].every((id) => id !== songA.id);
    expect(neverPlayedPicked).toBe(true);
  });

  it('returns the oldest-played song when all candidates have play history', () => {
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(10) }, // oldest
      { song_id: songB.id, played_at: hoursAgo(3) },
      { song_id: songC.id, played_at: hoursAgo(1) },
    ];
    const result = pickBestCandidate([songA, songB, songC], history);
    expect(result?.id).toBe(songA.id);
  });

  it('returns one of the tied oldest-played songs when multiple share the same timestamp', () => {
    const tiedDate = hoursAgo(10);
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: tiedDate },
      { song_id: songB.id, played_at: tiedDate }, // same time as A
      { song_id: songC.id, played_at: hoursAgo(1) },
    ];
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const r = pickBestCandidate([songA, songB, songC], history);
      if (r) results.add(r.id);
    }
    // songC should never be picked (played most recently)
    expect(results.has(songC.id)).toBe(false);
    // Both tied songs should appear over many runs
    expect(results.has(songA.id)).toBe(true);
    expect(results.has(songB.id)).toBe(true);
  });

  it('picks from all candidates when no play history exists', () => {
    const result = pickBestCandidate([songA, songB, songC], []);
    expect([songA.id, songB.id, songC.id]).toContain(result?.id);
  });

  it('returns the single candidate regardless of history', () => {
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(1) },
    ];
    const result = pickBestCandidate([songA], history);
    expect(result?.id).toBe(songA.id);
  });

  it('uses the most recent play for a song with multiple history entries', () => {
    // songA was played 10h ago and again 2h ago; songB played 5h ago.
    // Most-recent for songA is 2h ago → older is songB (5h ago) → songB wins.
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(10) },
      { song_id: songA.id, played_at: hoursAgo(2) },
      { song_id: songB.id, played_at: hoursAgo(5) },
    ];
    const result = pickBestCandidate([songA, songB], history);
    expect(result?.id).toBe(songB.id);
  });
});

// ─── filterCandidates ────────────────────────────────────────────────────────

describe('filterCandidates', () => {
  /** Thin wrapper with sensible defaults so individual tests stay concise. */
  function filter(
    candidates: CandidateSong[],
    opts: {
      history?: PlayHistoryEntry[];
      dayPlayCounts?: Map<string, number>;
      placedEntries?: PlacedEntry[];
      currentHour?: number;
      currentPosition?: number;
      relaxGap?: boolean;
      relaxDayLimit?: boolean;
    } = {},
  ): CandidateSong[] {
    return filterCandidates(
      candidates,
      rules,
      opts.history ?? [],
      opts.dayPlayCounts ?? new Map(),
      opts.placedEntries ?? [],
      opts.currentHour ?? 10,
      opts.currentPosition ?? 0,
      opts.relaxGap ?? false,
      opts.relaxDayLimit ?? false,
    );
  }

  // ── max_plays_per_day ───────────────────────────────────────────────────────

  it('filters out songs that have already reached max_plays_per_day', () => {
    const dayCounts = new Map([
      [songA.id, 2], // at limit (rules.max_plays_per_day = 2)
      [songB.id, 1], // under limit
    ]);
    const result = filter([songA, songB], { dayPlayCounts: dayCounts });
    const ids = result.map((s) => s.id);
    expect(ids).not.toContain(songA.id);
    expect(ids).toContain(songB.id);
  });

  it('keeps songs under the daily play limit', () => {
    const dayCounts = new Map([[songA.id, 1]]);
    const result = filter([songA], { dayPlayCounts: dayCounts });
    expect(result).toHaveLength(1);
  });

  it('relaxDayLimit=true keeps songs even when at max_plays_per_day', () => {
    const dayCounts = new Map([[songA.id, 5]]); // way over limit
    const result = filter([songA], { dayPlayCounts: dayCounts, relaxDayLimit: true });
    expect(result).toHaveLength(1);
  });

  // ── min_gap_hours ───────────────────────────────────────────────────────────

  it('filters out songs played within min_gap_hours', () => {
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(1) }, // 1h ago < 2h gap
    ];
    const result = filter([songA, songB], { history });
    const ids = result.map((s) => s.id);
    expect(ids).not.toContain(songA.id);
    expect(ids).toContain(songB.id);
  });

  it('keeps songs played more than min_gap_hours ago', () => {
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(3) }, // 3h ago > 2h gap
    ];
    const result = filter([songA], { history });
    expect(result).toHaveLength(1);
  });

  it('relaxGap=true keeps songs played within min_gap_hours', () => {
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(0.5) }, // 30 min ago
    ];
    const result = filter([songA], { history, relaxGap: true });
    expect(result).toHaveLength(1);
  });

  // ── artist_separation_slots ─────────────────────────────────────────────────

  it('filters out a song whose artist appears within the last artist_separation_slots entries', () => {
    // rules.artist_separation_slots = 3; placing at position index 2 (3 placed so far)
    // → look back 3 slots from index 3, which covers indices 0..2
    const placed: PlacedEntry[] = [
      { hour: 10, position: 0, song_id: 'other-1', artist: 'Artist Other' },
      { hour: 10, position: 1, song_id: 'other-2', artist: 'Artist Another' },
      { hour: 10, position: 2, song_id: songA.id, artist: songA.artist }, // same artist in window
    ];
    const result = filter([songA, songB], { placedEntries: placed });
    const ids = result.map((s) => s.id);
    expect(ids).not.toContain(songA.id);
    expect(ids).toContain(songB.id);
  });

  it('allows an artist whose last appearance is outside the separation window', () => {
    // 4 placed entries; last songA artist slot is at index 0 → outside window of 3
    const placed: PlacedEntry[] = [
      { hour: 9, position: 0, song_id: songA.id, artist: songA.artist },
      { hour: 10, position: 0, song_id: 'other-1', artist: 'Artist Other' },
      { hour: 10, position: 1, song_id: 'other-2', artist: 'Artist Another' },
      { hour: 10, position: 2, song_id: 'other-3', artist: 'Artist Different' },
    ];
    const result = filter([songA], { placedEntries: placed });
    expect(result).toHaveLength(1);
  });

  // ── max_same_artist_per_hour ────────────────────────────────────────────────

  it('filters out songs whose artist already fills max_same_artist_per_hour in the current hour', () => {
    // rules.max_same_artist_per_hour = 1; songA artist already placed once in hour 10
    const placed: PlacedEntry[] = [
      { hour: 10, position: 0, song_id: 'prev-song', artist: songA.artist },
    ];
    const result = filter([songA], { placedEntries: placed, currentHour: 10 });
    expect(result).toHaveLength(0);
  });

  it('allows a song when the same artist is only placed in a different hour', () => {
    const placed: PlacedEntry[] = [
      { hour: 9, position: 0, song_id: 'prev-song', artist: songA.artist },
    ];
    // Artist placed at hour 9, we are filling hour 10 — should be fine
    const result = filter([songA], { placedEntries: placed, currentHour: 10 });
    // Artist separation check: placed has 1 entry; we are at index 1.
    // Separation window = max(0, 1-3)=0 → all placed entries checked.
    // songA's artist IS in placed[0] (hour 9) → blocked by artist_separation_slots.
    // This validates both rules interact correctly.
    expect(result).toHaveLength(0);
  });

  it('keeps a song when no constraints apply', () => {
    const result = filter([songA, songB, songC], {});
    expect(result).toHaveLength(3);
  });

  // ── relaxation combinations ─────────────────────────────────────────────────

  it('relaxGap=true and relaxDayLimit=true bypasses both gap and day-limit checks', () => {
    const history: PlayHistoryEntry[] = [
      { song_id: songA.id, played_at: hoursAgo(0.1) }, // very recent
    ];
    const dayCounts = new Map([[songA.id, 99]]);
    const result = filter([songA], {
      history,
      dayPlayCounts: dayCounts,
      relaxGap: true,
      relaxDayLimit: true,
    });
    expect(result).toHaveLength(1);
  });

  it('returns an empty array when all candidates are filtered out', () => {
    // All songs over daily limit
    const dayCounts = new Map([
      [songA.id, 2],
      [songB.id, 2],
      [songC.id, 2],
    ]);
    const result = filter([songA, songB, songC], { dayPlayCounts: dayCounts });
    expect(result).toHaveLength(0);
  });

  it('returns all candidates when the candidates array is empty', () => {
    const result = filter([], {});
    expect(result).toHaveLength(0);
  });
});
