/**
 * Unit tests for hlsBuilder helpers — music.m3u8 content generation,
 * program-timeline offset computation, and DJ clip resolution.
 * Issue #532: dynamic layered audio (feat/issue-532)
 */
import { describe, it, expect } from 'vitest';
import {
  buildEntryCumulativeMap,
  buildMusicM3u8,
  resolveDjClips,
  type SongEntry,
  type DjSegmentRow,
} from '../../src/queues/hlsBuilder.js';

// ── Fixtures ─────────────────────────────────────────────────────────────

const song1: SongEntry = { entry_id: 'e1', audio_url: 'https://cdn/songs/s1.aac', duration_sec: 200 };
const song2: SongEntry = { entry_id: 'e2', audio_url: 'https://cdn/songs/s2.aac', duration_sec: 180 };
const song3: SongEntry = { entry_id: 'e3', audio_url: null, duration_sec: 150 }; // no audio yet
const song4: SongEntry = { entry_id: 'e4', audio_url: 'https://cdn/songs/s4.aac', duration_sec: 240 };

// ── buildEntryCumulativeMap ───────────────────────────────────────────────

describe('buildEntryCumulativeMap', () => {
  it('maps first entry to 0, subsequent entries to cumulative seconds', () => {
    const map = buildEntryCumulativeMap([song1, song2, song3, song4]);
    expect(map.get('e1')).toBe(0);
    expect(map.get('e2')).toBe(200);
    expect(map.get('e3')).toBe(380);   // 200 + 180
    expect(map.get('e4')).toBe(530);   // 200 + 180 + 150
  });

  it('treats null duration_sec as 0', () => {
    const entries: SongEntry[] = [
      { entry_id: 'x1', audio_url: null, duration_sec: null },
      { entry_id: 'x2', audio_url: null, duration_sec: 100 },
    ];
    const map = buildEntryCumulativeMap(entries);
    expect(map.get('x1')).toBe(0);
    expect(map.get('x2')).toBe(0); // null duration contributes 0
  });

  it('returns empty map for empty input', () => {
    expect(buildEntryCumulativeMap([]).size).toBe(0);
  });
});

// ── buildMusicM3u8 ────────────────────────────────────────────────────────

describe('buildMusicM3u8', () => {
  it('produces a valid HLS VOD playlist', () => {
    const m3u8 = buildMusicM3u8([song1, song2]);
    expect(m3u8).toContain('#EXTM3U');
    expect(m3u8).toContain('#EXT-X-VERSION:3');
    expect(m3u8).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(m3u8).toContain('#EXT-X-ENDLIST');
  });

  it('includes correct #EXTINF durations and CDN URLs', () => {
    const m3u8 = buildMusicM3u8([song1, song2]);
    expect(m3u8).toContain('#EXTINF:200.000,');
    expect(m3u8).toContain('https://cdn/songs/s1.aac');
    expect(m3u8).toContain('#EXTINF:180.000,');
    expect(m3u8).toContain('https://cdn/songs/s2.aac');
  });

  it('skips songs without audio_url', () => {
    const m3u8 = buildMusicM3u8([song1, song3, song2]);
    // song3 has no audio — should not appear
    const lines = m3u8.split('\n');
    expect(lines).not.toContain('null');
    const urlLines = lines.filter(l => l.startsWith('https://'));
    expect(urlLines).toHaveLength(2);
  });

  it('sets #EXT-X-TARGETDURATION to the ceiling of the longest song', () => {
    const m3u8 = buildMusicM3u8([song1, song2, song4]);
    expect(m3u8).toContain('#EXT-X-TARGETDURATION:240');
  });

  it('returns minimal playlist when no songs have audio', () => {
    const m3u8 = buildMusicM3u8([song3]);
    expect(m3u8).toContain('#EXTM3U');
    expect(m3u8).toContain('#EXT-X-ENDLIST');
    const urlLines = m3u8.split('\n').filter(l => l.startsWith('https://'));
    expect(urlLines).toHaveLength(0);
  });
});

// ── resolveDjClips ────────────────────────────────────────────────────────

describe('resolveDjClips', () => {
  const cumulativeMap = buildEntryCumulativeMap([song1, song2, song4]);
  // e1 = 0, e2 = 200, e4 = 380; total = 620s

  const floatingAdlib: DjSegmentRow = {
    id: 'seg-float',
    segment_type: 'adlib',
    audio_url: 'https://cdn/dj/float.mp3',
    audio_duration_sec: 4,
    playlist_entry_id: null,
    anchor_playlist_entry_id: 'e2',
    start_offset_sec: 60, // 60s into song2 → program offset = 200 + 60 = 260
  };

  const sequentialIntro: DjSegmentRow = {
    id: 'seg-seq',
    segment_type: 'song_intro',
    audio_url: 'https://cdn/dj/intro.mp3',
    audio_duration_sec: 8,
    playlist_entry_id: 'e4',
    anchor_playlist_entry_id: null,
    start_offset_sec: null,
    // Associated with e4 (song4) → program offset = 380s
  };

  const showOutro: DjSegmentRow = {
    id: 'seg-outro',
    segment_type: 'show_outro',
    audio_url: 'https://cdn/dj/outro.mp3',
    audio_duration_sec: 15,
    playlist_entry_id: null,
    anchor_playlist_entry_id: null,
    start_offset_sec: null,
    // Unanchored show_outro → offset = total - duration = 620 - 15 = 605
  };

  const showIntro: DjSegmentRow = {
    id: 'seg-intro',
    segment_type: 'show_intro',
    audio_url: 'https://cdn/dj/showintro.mp3',
    audio_duration_sec: 10,
    playlist_entry_id: null,
    anchor_playlist_entry_id: null,
    start_offset_sec: null,
    // Unanchored non-outro → offset = 0
  };

  const noAudio: DjSegmentRow = {
    id: 'seg-silent',
    segment_type: 'adlib',
    audio_url: null,
    audio_duration_sec: 5,
    playlist_entry_id: 'e1',
    anchor_playlist_entry_id: null,
    start_offset_sec: null,
  };

  const totalDuration = 620;

  it('resolves floating segment to song_start + start_offset_sec', () => {
    const clips = resolveDjClips([floatingAdlib], cumulativeMap, totalDuration);
    expect(clips).toHaveLength(1);
    expect(clips[0].offsetSec).toBe(260); // 200 + 60
    expect(clips[0].durationSec).toBe(4);
    expect(clips[0].audioUrl).toBe('https://cdn/dj/float.mp3');
  });

  it('resolves sequential segment to its entry start_sec', () => {
    const clips = resolveDjClips([sequentialIntro], cumulativeMap, totalDuration);
    expect(clips).toHaveLength(1);
    expect(clips[0].offsetSec).toBe(380); // song4 starts at 380
  });

  it('places show_outro at total_duration minus its duration', () => {
    const clips = resolveDjClips([showOutro], cumulativeMap, totalDuration);
    expect(clips).toHaveLength(1);
    expect(clips[0].offsetSec).toBe(605); // 620 - 15
  });

  it('places show_intro and other unanchored segments at offset 0', () => {
    const clips = resolveDjClips([showIntro], cumulativeMap, totalDuration);
    expect(clips).toHaveLength(1);
    expect(clips[0].offsetSec).toBe(0);
  });

  it('skips segments without audio_url', () => {
    const clips = resolveDjClips([noAudio], cumulativeMap, totalDuration);
    expect(clips).toHaveLength(0);
  });

  it('skips floating segments whose anchor entry_id is not in the map', () => {
    const orphan: DjSegmentRow = {
      ...floatingAdlib, anchor_playlist_entry_id: 'nonexistent-id',
    };
    const clips = resolveDjClips([orphan], cumulativeMap, totalDuration);
    expect(clips).toHaveLength(0);
  });

  it('clamps offset to prevent clip from exceeding total duration', () => {
    const lateClip: DjSegmentRow = {
      ...floatingAdlib,
      start_offset_sec: 175, // 200 + 175 = 375; clip is 4s, so max offset = 616 → fine
      audio_duration_sec: 30, // song2 starts at 200, so 200+175+30 = 405 < 620, fine
    };
    const clips = resolveDjClips([lateClip], cumulativeMap, totalDuration);
    expect(clips[0].offsetSec).toBeLessThanOrEqual(totalDuration - 30);
  });

  it('resolves multiple mixed segments correctly', () => {
    const segs = [floatingAdlib, sequentialIntro, showOutro, showIntro, noAudio];
    const clips = resolveDjClips(segs, cumulativeMap, totalDuration);
    // noAudio is skipped, rest are resolved
    expect(clips).toHaveLength(4);
    const offsets = clips.map(c => c.offsetSec).sort((a, b) => a - b);
    expect(offsets).toEqual([0, 260, 380, 605]);
  });
});
