/**
 * Pure helpers for computing the currently playing song from a CDN-backed HLS stream.
 *
 * Extracted for testability — no I/O, no side effects.
 */

export interface AudioSegment {
  sort_order: number;
  song_title: string | null;
  song_artist: string | null;
  duration_sec: number;
}

export interface CurrentSong {
  song_title: string;
  song_artist: string;
}

/**
 * Walk audio segments in play order and return the song that's currently playing
 * based on elapsed time since the start of the broadcast.
 *
 * Algorithm: accumulate durations until the running total exceeds elapsedSec —
 * the last song we passed is the one currently playing.
 */
export function computeCurrentSong(
  segments: AudioSegment[],
  elapsedSec: number,
): CurrentSong | null {
  let cumulative = 0;
  let current: CurrentSong | null = null;

  for (const seg of segments) {
    if (seg.song_title) {
      if (cumulative <= elapsedSec) {
        current = { song_title: seg.song_title, song_artist: seg.song_artist ?? '' };
      } else {
        break;
      }
    }
    cumulative += seg.duration_sec;
  }

  // If no song reached yet (elapsedSec < first song's cumulative start), return the first song
  if (!current) {
    const first = segments.find((s) => s.song_title);
    if (first) return { song_title: first.song_title!, song_artist: first.song_artist ?? '' };
  }

  return current;
}

/**
 * Compute elapsed seconds since midnight of playlistDate in the given timezone.
 *
 * Returns totalDurationSec when playlistDate is not today (so the caller will
 * fall back to the last song in the stream rather than an arbitrary position).
 *
 * @param playlistDate  ISO date string, e.g. "2026-05-03"
 * @param timezone      IANA tz, e.g. "Asia/Manila"
 * @param totalDurationSec  total stream duration (sum of all segment durations)
 * @param nowMs         override for current time (default: Date.now()), for testing
 */
export function computeElapsedSec(
  playlistDate: string,
  timezone: string,
  totalDurationSec: number,
  nowMs?: number,
): number {
  const tz = timezone || 'UTC';
  const now = new Date(nowMs ?? Date.now());
  const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const todayStr = nowInTz.toISOString().slice(0, 10);

  if (playlistDate !== todayStr) {
    // Playlist is not for today — treat as if we've passed the entire stream
    return totalDurationSec;
  }

  const midnightInTz = new Date(nowInTz);
  midnightInTz.setHours(0, 0, 0, 0);
  return (nowInTz.getTime() - midnightInTz.getTime()) / 1000;
}
