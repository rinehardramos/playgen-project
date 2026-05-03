/**
 * Tests for issue #491: status.json now-playing computation helpers.
 *
 * Covers:
 * - computeCurrentSong: returns correct song based on elapsed time
 * - computeElapsedSec: correct elapsed time for today vs other days
 */
import { describe, it, expect } from 'vitest';
import { computeCurrentSong, computeElapsedSec } from '../../src/playout/nowPlayingHelper';
import type { AudioSegment } from '../../src/playout/nowPlayingHelper';

// ── Helpers ────────────────────────────────────────────────────────────────────

function song(sort_order: number, title: string, artist: string, duration_sec: number): AudioSegment {
  return { sort_order, song_title: title, song_artist: artist, duration_sec };
}

function speech(sort_order: number, duration_sec: number): AudioSegment {
  return { sort_order, song_title: null, song_artist: null, duration_sec };
}

// ── computeCurrentSong ────────────────────────────────────────────────────────

describe('computeCurrentSong', () => {
  const segments: AudioSegment[] = [
    speech(0, 30),                             // show intro: 0–30s
    song(0.5, 'Song A', 'Artist A', 200),      // Song A: 30–230s
    speech(1, 15),                             // transition: 230–245s
    song(1.5, 'Song B', 'Artist B', 210),      // Song B: 245–455s
    speech(2, 10),                             // outro: 455–465s
    song(2.5, 'Song C', 'Artist C', 195),      // Song C: 465–660s
  ];

  it('returns first song when elapsed is within show intro', () => {
    const result = computeCurrentSong(segments, 15);
    // elapsed=15s — still in show intro, first song not reached yet → return first song
    expect(result?.song_title).toBe('Song A');
  });

  it('returns Song A when elapsed is inside Song A window', () => {
    const result = computeCurrentSong(segments, 100);
    expect(result?.song_title).toBe('Song A');
    expect(result?.song_artist).toBe('Artist A');
  });

  it('returns Song A when elapsed equals its start', () => {
    const result = computeCurrentSong(segments, 30);
    expect(result?.song_title).toBe('Song A');
  });

  it('returns Song B when elapsed is inside Song B window', () => {
    const result = computeCurrentSong(segments, 300);
    expect(result?.song_title).toBe('Song B');
    expect(result?.song_artist).toBe('Artist B');
  });

  it('returns Song C when elapsed is at start of Song C', () => {
    const result = computeCurrentSong(segments, 465);
    expect(result?.song_title).toBe('Song C');
  });

  it('returns Song C when elapsed is past the end of the stream', () => {
    const result = computeCurrentSong(segments, 9999);
    expect(result?.song_title).toBe('Song C');
  });

  it('returns null when there are no songs in segment list', () => {
    const noSongs: AudioSegment[] = [speech(0, 60), speech(1, 60)];
    const result = computeCurrentSong(noSongs, 30);
    expect(result).toBeNull();
  });

  it('returns the only song when there is exactly one song', () => {
    const oneTrack: AudioSegment[] = [
      speech(0, 20),
      song(0.5, 'Only Song', 'Only Artist', 180),
    ];
    const result = computeCurrentSong(oneTrack, 50);
    expect(result?.song_title).toBe('Only Song');
  });

  it('includes artist in result', () => {
    const result = computeCurrentSong(segments, 300);
    expect(result?.song_artist).toBe('Artist B');
  });

  it('defaults song_artist to empty string when null in DB', () => {
    const segs: AudioSegment[] = [
      { sort_order: 0, song_title: 'No Artist Song', song_artist: null, duration_sec: 200 },
    ];
    const result = computeCurrentSong(segs, 10);
    expect(result?.song_artist).toBe('');
  });
});

// ── computeElapsedSec ─────────────────────────────────────────────────────────

describe('computeElapsedSec', () => {
  // Pin a fake "now": 2026-05-03 10:30:00 UTC (= 10:30 in UTC timezone)
  // 10h 30m = 37800 seconds since midnight UTC
  const may3At1030Utc = new Date('2026-05-03T10:30:00Z').getTime();

  it('returns elapsed seconds since midnight when playlist is today', () => {
    const elapsed = computeElapsedSec('2026-05-03', 'UTC', 3600, may3At1030Utc);
    expect(elapsed).toBeCloseTo(37800, 0); // 10.5 hours in seconds
  });

  it('returns totalDurationSec when playlist is for a different day (yesterday)', () => {
    const elapsed = computeElapsedSec('2026-05-02', 'UTC', 3600, may3At1030Utc);
    expect(elapsed).toBe(3600); // returns totalDurationSec
  });

  it('returns totalDurationSec when playlist is for a future day', () => {
    const elapsed = computeElapsedSec('2026-05-04', 'UTC', 7200, may3At1030Utc);
    expect(elapsed).toBe(7200);
  });

  it('uses UTC when timezone is empty string', () => {
    const elapsed = computeElapsedSec('2026-05-03', '', 3600, may3At1030Utc);
    expect(elapsed).toBeCloseTo(37800, 0);
  });

  it('accounts for timezone offset (Asia/Manila = UTC+8)', () => {
    // 2026-05-03T10:30:00Z = 2026-05-03T18:30:00 Manila time
    // elapsed since midnight Manila = 18h 30m = 66600s
    const elapsed = computeElapsedSec('2026-05-03', 'Asia/Manila', 3600, may3At1030Utc);
    expect(elapsed).toBeCloseTo(66600, -1); // within ~10 seconds tolerance
  });

  it('Manila timezone: different date when UTC day has rolled over', () => {
    // 2026-05-03T15:30:00Z = 2026-05-03T23:30:00 Manila (still same day)
    const stillMay3Manila = new Date('2026-05-03T15:30:00Z').getTime();
    const elapsed = computeElapsedSec('2026-05-03', 'Asia/Manila', 9999, stillMay3Manila);
    expect(elapsed).not.toBe(9999); // still today in Manila — elapsed != totalDuration
  });
});
