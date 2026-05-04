/**
 * Pure helpers for building HLS playlist content and program-timeline offsets.
 * Extracted so they can be unit-tested without mocking DB/S3/ffmpeg.
 */

export interface SongEntry {
  entry_id: string;
  audio_url: string | null;
  duration_sec: number | null;
}

export interface DjSegmentRow {
  id: string;
  segment_type: string;
  audio_url: string | null;
  audio_duration_sec: number | null;
  playlist_entry_id: string | null;
  anchor_playlist_entry_id: string | null;
  start_offset_sec: number | null;
}

export interface DjClip {
  segId: string;
  audioUrl: string;
  offsetSec: number;
  durationSec: number;
}

/**
 * Compute the cumulative start_sec for each playlist entry in show order.
 * Returns a Map<entry_id, startSec>.
 */
export function buildEntryCumulativeMap(entries: SongEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  let cumulativeSec = 0;
  for (const entry of entries) {
    map.set(entry.entry_id, cumulativeSec);
    cumulativeSec += Math.max(0, entry.duration_sec ?? 0);
  }
  return map;
}

/**
 * Deterministic pseudo-random float in [min, max) seeded by a string.
 * Uses FNV-1a hash so the same segment always receives the same jitter,
 * making HLS rebuilds (e.g. on publish retry) produce identical output.
 */
function seededJitter(seed: string, min: number, max: number): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return min + ((h % 10000) / 10000) * (max - min);
}

/**
 * Resolve all DJ segments to absolute program-timeline clips.
 * Skips segments without audio or unresolvable anchors.
 *
 * song_transition sequential segments receive a seeded jitter of -1.5 to +2.0 s
 * so the DJ doesn't always cut in at the exact song boundary — emulating the
 * natural dead-air pauses and early cut-ins heard on live radio (Issue #422).
 */
export function resolveDjClips(
  allSegs: DjSegmentRow[],
  entryCumulativeSec: Map<string, number>,
  totalMusicDurationSec: number,
): DjClip[] {
  const clips: DjClip[] = [];

  for (const seg of allSegs) {
    if (!seg.audio_url) continue;
    const durSec = seg.audio_duration_sec != null ? parseFloat(String(seg.audio_duration_sec)) : 0;
    if (durSec <= 0) continue;

    let offsetSec: number;

    if (seg.anchor_playlist_entry_id != null && seg.start_offset_sec != null) {
      // Floating segment: offset = song_start + start_offset_sec
      const songStartSec = entryCumulativeSec.get(seg.anchor_playlist_entry_id);
      if (songStartSec == null) continue;
      offsetSec = songStartSec + parseFloat(String(seg.start_offset_sec));
    } else if (seg.playlist_entry_id != null) {
      // Sequential segment: offset = associated entry's start in music timeline.
      // song_transition segments get seeded jitter (-1.5 s to +2.0 s) to
      // simulate natural dead-air gaps and early DJ cut-ins (Issue #422).
      const songStartSec = entryCumulativeSec.get(seg.playlist_entry_id);
      if (songStartSec == null) continue;
      const jitter = seg.segment_type === 'song_transition'
        ? seededJitter(seg.id, -1.5, 2.0)
        : 0;
      offsetSec = songStartSec + jitter;
    } else {
      // Unanchored: show_outro at end, everything else at 0
      offsetSec = seg.segment_type === 'show_outro'
        ? Math.max(0, totalMusicDurationSec - durSec)
        : 0;
    }

    // Clamp to music track duration
    offsetSec = Math.max(0, Math.min(offsetSec, totalMusicDurationSec - durSec));
    clips.push({ segId: seg.id, audioUrl: seg.audio_url, offsetSec, durationSec: durSec });
  }

  return clips;
}

export type { VariantStream } from './hlsVariantBuilder.js';
export { buildVariantMasterM3u8 } from './hlsVariantBuilder.js';

/**
 * Build the text content of a music.m3u8 HLS packed-audio playlist.
 * References song CDN URLs as ADTS AAC segments — no transcoding required.
 */
export function buildMusicM3u8(entries: SongEntry[]): string {
  const audioEntries = entries.filter(e => e.audio_url);
  const maxDuration = audioEntries.reduce((m, e) => Math.max(m, e.duration_sec ?? 0), 0);

  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${Math.ceil(maxDuration)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];

  for (const entry of audioEntries) {
    const dur = entry.duration_sec ?? 0;
    lines.push(`#EXTINF:${dur.toFixed(3)},`);
    lines.push(entry.audio_url!);
  }

  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}
