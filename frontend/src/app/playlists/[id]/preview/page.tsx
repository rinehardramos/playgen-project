'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';
import {
  buildTimeline,
  DJ_COLORS,
  SONG_STYLE,
  formatTimeSec as formatTime,
  formatDurSec as formatDur,
  DEFAULT_DJ_SEC,
  DEFAULT_SONG_SEC,
  type TimelineDjSegment as DjSegment,
  type TimelinePlaylistEntry,
} from '@/lib/timeline';

// ─── Types ─────────────────────────────────────────────────────────────────────

type PlaylistStatus = 'draft' | 'generating' | 'ready' | 'approved' | 'exported' | 'failed';

interface Playlist {
  id: string;
  date: string;
  status: PlaylistStatus;
  station_id: string;
  template_name?: string;
  notes?: string;
}

interface PlaylistEntry extends TimelinePlaylistEntry {
  song_id: string;
  category_label?: string;
  is_manual_override?: boolean;
}

interface DjScript {
  id: string;
  review_status: string;
  segments: DjSegment[];
  total_segments: number;
  llm_model?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const PX_PER_SEC = 4;
const MIN_DJ_PX = 80;
const MIN_SONG_PX = 140;

function blockPx(durationSec: number, min: number): number {
  return Math.max(min, Math.round(durationSec * PX_PER_SEC));
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PlaylistPreviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const playlistId = params.id;

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [entries, setEntries] = useState<PlaylistEntry[]>([]);
  const [script, setScript] = useState<DjScript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishedMsg, setPublishedMsg] = useState<string | null>(null);

  const [paddingSec, setPaddingSec] = useState(2);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);
  const [isPlayingAll, setIsPlayingAll] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playQueueRef = useRef<DjSegment[]>([]);
  const playIdxRef = useRef<number>(0);

  // ── Auth guard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.replace('/login');
    }
  }, [router]);

  // ── Data fetch ─────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Fetch playlist with entries
        const pl = await api.get<Playlist & { entries?: PlaylistEntry[] }>(
          `/api/v1/playlists/${playlistId}`,
        );
        const { entries: rawEntries, ...plData } = pl as Playlist & { entries?: PlaylistEntry[] };
        setPlaylist(plData);
        setEntries(rawEntries ?? []);

        // Fetch the DJ script for this playlist (approved or most recent)
        try {
          const scriptData = await api.get<DjScript>(
            `/api/v1/dj/playlists/${playlistId}/script`,
          );
          setScript(scriptData);
        } catch (scriptErr: unknown) {
          const e = scriptErr as ApiError;
          if (e.status !== 404) {
            // Non-404 error — show warning but don't block page
            console.warn('Could not load DJ script:', e.message);
          }
          // 404 = no script yet, that's fine
        }
      } catch (err: unknown) {
        setError((err as ApiError).message ?? 'Failed to load playlist');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [playlistId]);

  // ── Playback ───────────────────────────────────────────────────────────────

  const stopPlayback = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingSegmentId(null);
    setIsPlayingAll(false);
    playQueueRef.current = [];
    playIdxRef.current = 0;
  }, []);

  function playNextInQueue() {
    const queue = playQueueRef.current;
    const idx = playIdxRef.current;
    if (idx >= queue.length) {
      stopPlayback();
      return;
    }
    const seg = queue[idx];
    playIdxRef.current = idx + 1;
    const base = process.env.NEXT_PUBLIC_API_URL ?? '';
    const url = `${base}${seg.audio_url}`;
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingSegmentId(seg.id);
    audio.onended = () => playNextInQueue();
    audio.onerror = () => playNextInQueue();
    audio.play().catch(() => playNextInQueue());
  }

  function handlePlayAll() {
    if (!script) return;
    if (isPlayingAll) {
      stopPlayback();
      return;
    }
    const djSegmentsWithAudio = script.segments
      .filter((s) => s.audio_url)
      .sort((a, b) => a.position - b.position);
    if (djSegmentsWithAudio.length === 0) return;
    stopPlayback();
    playQueueRef.current = djSegmentsWithAudio;
    playIdxRef.current = 0;
    setIsPlayingAll(true);
    playNextInQueue();
  }

  function handlePlaySegment(seg: DjSegment) {
    if (!seg.audio_url) return;
    if (playingSegmentId === seg.id) {
      stopPlayback();
      return;
    }
    stopPlayback();
    const base = process.env.NEXT_PUBLIC_API_URL ?? '';
    const audio = new Audio(`${base}${seg.audio_url}`);
    audioRef.current = audio;
    setPlayingSegmentId(seg.id);
    audio.onended = () => {
      audioRef.current = null;
      setPlayingSegmentId(null);
    };
    audio.onerror = () => {
      audioRef.current = null;
      setPlayingSegmentId(null);
    };
    audio.play().catch(() => {
      audioRef.current = null;
      setPlayingSegmentId(null);
    });
  }

  // ── Publish ────────────────────────────────────────────────────────────────

  async function handlePublish() {
    if (!playlist) return;
    if (playlist.status === 'exported') {
      setPublishedMsg('This playlist is already published.');
      return;
    }
    setPublishing(true);
    setPublishedMsg(null);
    try {
      const updated = await api.patch<Playlist>(`/api/v1/playlists/${playlistId}`, {
        status: 'exported',
      });
      setPlaylist(updated);
      setPublishedMsg('Playlist published successfully!');
    } catch (err: unknown) {
      setPublishedMsg((err as ApiError).message ?? 'Failed to publish playlist');
    } finally {
      setPublishing(false);
    }
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  const previewEntries: TimelinePlaylistEntry[] = entries.map((e) => ({
    id: e.id,
    hour: e.hour,
    position: e.position,
    song_title: e.song_title,
    song_artist: e.song_artist,
    duration_sec: e.duration_sec,
  }));

  const timeline = script ? buildTimeline(script.segments, previewEntries, paddingSec) : [];
  const totalDurationSec = timeline.reduce((s, item) => s + item.durationSec, 0);

  const djSegmentsWithAudio = script
    ? script.segments.filter((s) => s.audio_url).sort((a, b) => a.position - b.position)
    : [];

  const totalWidth = timeline.reduce(
    (s, item) =>
      s +
      (item.kind === 'song'
        ? blockPx(item.durationSec, MIN_SONG_PX)
        : item.kind === 'dj'
        ? blockPx(item.durationSec, MIN_DJ_PX)
        : Math.max(8, Math.round(item.durationSec * PX_PER_SEC))),
    0,
  );

  const hoveredItem = hoveredIdx !== null ? timeline[hoveredIdx] : null;

  const dateLabel = playlist?.date
    ? new Date(playlist.date.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Playlist';

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0b0b10]">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#0b0b10] gap-4">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => router.back()}
          className="text-gray-400 hover:text-white text-sm underline"
        >
          Go back
        </button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0b10] overflow-hidden">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[#2a2a40] bg-[#13131a]">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          {/* Back button */}
          <button
            onClick={() => { stopPlayback(); router.back(); }}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Back</span>
          </button>

          <div className="w-px h-5 bg-[#2a2a40] flex-shrink-0" />

          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white leading-none truncate">{dateLabel}</h2>
            <p className="text-[10px] text-gray-500 mt-0.5 font-mono">
              {script
                ? `${formatTime(totalDurationSec)} estimated runtime`
                : 'No DJ script yet'}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Play All DJ Audio */}
          <button
            onClick={handlePlayAll}
            disabled={djSegmentsWithAudio.length === 0}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isPlayingAll
                ? 'bg-violet-600 hover:bg-violet-700 text-white'
                : 'bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300'
            }`}
          >
            {isPlayingAll ? (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
                <span className="hidden sm:inline">Stop</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="hidden sm:inline">Play DJ Audio</span>
              </>
            )}
          </button>

          {/* Publish */}
          <button
            onClick={handlePublish}
            disabled={publishing || playlist?.status === 'exported'}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              playlist?.status === 'exported'
                ? 'bg-violet-900/20 border border-violet-700/30 text-violet-500 cursor-default'
                : 'bg-green-700 hover:bg-green-600 text-white disabled:opacity-50'
            }`}
          >
            {publishing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span className="hidden sm:inline">Publishing…</span>
              </>
            ) : playlist?.status === 'exported' ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="hidden sm:inline">Published</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                <span className="hidden sm:inline">Publish</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Publish feedback toast ─────────────────────────────────────────────── */}
      {publishedMsg && (
        <div
          className={`flex-shrink-0 px-6 py-2.5 text-sm border-b ${
            publishedMsg.includes('success') || publishedMsg.includes('already')
              ? 'bg-green-900/20 border-green-700/30 text-green-400'
              : 'bg-red-900/20 border-red-700/30 text-red-400'
          }`}
        >
          {publishedMsg}
          <button
            onClick={() => setPublishedMsg(null)}
            className="ml-3 text-gray-500 hover:text-gray-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── No script state ────────────────────────────────────────────────────── */}
      {!script && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500">
          <svg
            className="w-14 h-14 text-gray-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
          <p className="text-sm">No DJ script has been generated for this playlist yet.</p>
          <button
            onClick={() => router.back()}
            className="text-violet-400 hover:text-violet-300 text-sm underline"
          >
            Go back to generate a script
          </button>
        </div>
      )}

      {/* ── Script loaded — full timeline UI ────────────────────────────────────── */}
      {script && (
        <>
          {/* Padding / transition control + legend */}
          <div className="flex-shrink-0 flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-[#2a2a40] bg-[#0f0f18]">
            <svg
              className="w-4 h-4 text-gray-600 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
            <label className="text-xs text-gray-500 font-medium whitespace-nowrap">
              Transition Padding
            </label>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={paddingSec}
              onChange={(e) => setPaddingSec(Number(e.target.value))}
              className="w-28 sm:w-36 accent-violet-500"
            />
            <span className="text-xs text-violet-300 font-mono w-8 text-right">{paddingSec}s</span>

            {/* Legend */}
            <div className="ml-auto flex items-center gap-3 sm:gap-4 text-[11px] text-gray-500 flex-shrink-0 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-slate-700 border border-slate-500 inline-block" />
                Songs
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-violet-700 border border-violet-500 inline-block" />
                DJ Segments
              </span>
              {paddingSec > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-[#1a1a28] border border-[#2a2a40] inline-block" />
                  Padding ({paddingSec}s)
                </span>
              )}
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">

            {/* Timeline track */}
            <div className="overflow-x-auto px-4 sm:px-6 pt-6 pb-2">
              <div
                className="flex items-stretch h-28 rounded-xl overflow-hidden border border-[#2a2a40]"
                style={{ width: `${totalWidth}px`, minWidth: '100%' }}
              >
                {timeline.map((item, idx) => {

                  // ── Gap block ─────────────────────────────────────────────
                  if (item.kind === 'gap') {
                    const w = Math.max(8, Math.round(item.durationSec * PX_PER_SEC));
                    return (
                      <div
                        key={`gap-${idx}`}
                        className="flex-shrink-0 bg-[#0d0d18] border-x border-[#1e1e2e] flex items-center justify-center"
                        style={{ width: `${w}px` }}
                        title={`${item.durationSec}s transition padding`}
                      >
                        {w >= 20 && item.durationSec >= 1 && (
                          <span
                            className="text-[8px] text-gray-700 select-none"
                            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                          >
                            {item.durationSec}s
                          </span>
                        )}
                      </div>
                    );
                  }

                  // ── Song block ────────────────────────────────────────────
                  if (item.kind === 'song') {
                    const w = blockPx(item.durationSec, MIN_SONG_PX);
                    const isHov = hoveredIdx === idx;
                    return (
                      <div
                        key={`song-${item.entry.id}-${idx}`}
                        className={`flex-shrink-0 relative overflow-hidden cursor-default select-none transition-all duration-100 ${SONG_STYLE.bg} border-r ${SONG_STYLE.border} ${isHov ? 'brightness-125' : 'brightness-90'}`}
                        style={{ width: `${w}px` }}
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onMouseLeave={() => setHoveredIdx(null)}
                        title={`${item.entry.song_title} — ${item.entry.song_artist}`}
                      >
                        {/* Pseudo-waveform decoration */}
                        <div
                          className="absolute inset-0 flex items-center gap-[2px] px-1 pointer-events-none"
                          aria-hidden
                        >
                          {Array.from({ length: Math.min(Math.floor(w / 3), 120) }, (_, i) => (
                            <div
                              key={i}
                              className="flex-shrink-0 bg-slate-400/25 rounded-full"
                              style={{
                                width: '2px',
                                height: `${18 + Math.abs(Math.sin(i * 0.61) * 30 + Math.cos(i * 1.17) * 20)}%`,
                              }}
                            />
                          ))}
                        </div>

                        {/* Label overlay */}
                        <div
                          className={`absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-slate-900/80 to-transparent ${SONG_STYLE.text}`}
                        >
                          <p className="text-[9px] font-bold uppercase tracking-wider leading-none truncate">
                            {item.entry.song_title}
                          </p>
                          <p className="text-[8px] opacity-60 leading-none mt-0.5 truncate">
                            {item.entry.song_artist}
                          </p>
                          <p className="text-[8px] font-mono opacity-50 leading-none mt-0.5">
                            {formatDur(item.durationSec)}
                            {item.entry.duration_sec == null && (
                              <span className="ml-1 text-amber-500/60">est.</span>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  }

                  // ── DJ segment block ──────────────────────────────────────
                  const colors = DJ_COLORS[item.segment.segment_type] ?? DJ_COLORS.show_intro;
                  const w = blockPx(item.durationSec, MIN_DJ_PX);
                  const isHov = hoveredIdx === idx;
                  const isPlaying = playingSegmentId === item.segment.id;
                  const hasAudio = !!item.segment.audio_url;

                  return (
                    <div
                      key={`dj-${item.segment.id}`}
                      className={`flex-shrink-0 relative overflow-hidden border-r transition-all duration-100 select-none
                        ${colors.bg} ${colors.border}
                        ${isHov ? 'brightness-125' : 'brightness-90'}
                        ${hasAudio ? 'cursor-pointer' : 'cursor-default'}
                        ${isPlaying ? 'ring-2 ring-inset ring-white/40' : ''}`}
                      style={{ width: `${w}px` }}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      onClick={() => hasAudio && handlePlaySegment(item.segment)}
                      title={`${item.segment.segment_type.replace(/_/g, ' ')}${hasAudio ? ' — click to play' : ' — no audio yet'}`}
                    >
                      {/* Playing animation */}
                      {isPlaying && (
                        <div
                          className="absolute top-2 left-2 flex gap-[3px] items-end h-4"
                          aria-hidden
                        >
                          {[0, 1, 2].map((i) => (
                            <div
                              key={i}
                              className="w-[3px] bg-white/80 rounded-full animate-bounce"
                              style={{
                                height: `${50 + i * 20}%`,
                                animationDelay: `${i * 0.12}s`,
                                animationDuration: '0.6s',
                              }}
                            />
                          ))}
                        </div>
                      )}

                      {/* No audio dim overlay */}
                      {!hasAudio && (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center pointer-events-none">
                          <span className="text-[8px] text-white/30 uppercase tracking-wide">
                            no audio
                          </span>
                        </div>
                      )}

                      {/* Play button overlay (for segments with audio) */}
                      {hasAudio && !isPlaying && isHov && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        </div>
                      )}

                      {/* Label */}
                      <div
                        className={`absolute bottom-0 left-0 right-0 px-1.5 py-1.5 bg-gradient-to-t from-black/50 to-transparent ${colors.text}`}
                      >
                        <p className="text-[9px] font-bold uppercase tracking-wider leading-none truncate">
                          {item.segment.segment_type.replace(/_/g, ' ')}
                        </p>
                        <p className="text-[8px] font-mono opacity-60 leading-none mt-0.5">
                          {hasAudio
                            ? formatDur(item.durationSec)
                            : 'est. ' + formatDur(item.durationSec)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Hover detail panel ──────────────────────────────────────────── */}
            <div className="px-4 sm:px-6 pt-3 pb-4">
              <div
                className={`rounded-xl border border-[#2a2a40] bg-[#13131a] p-4 transition-opacity duration-150 ${
                  hoveredItem && hoveredItem.kind !== 'gap'
                    ? 'opacity-100'
                    : 'opacity-0 pointer-events-none'
                }`}
                style={{ minHeight: '76px' }}
              >
                {hoveredItem && hoveredItem.kind === 'song' && (
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 bg-slate-500" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-bold text-white">
                          {hoveredItem.entry.song_title}
                        </span>
                        <span className="text-gray-600">·</span>
                        <span className="text-xs text-gray-400">{hoveredItem.entry.song_artist}</span>
                        <span className="text-gray-600">·</span>
                        <span className="text-xs text-gray-500 font-mono">
                          {formatDur(hoveredItem.durationSec)}
                          {hoveredItem.entry.duration_sec == null && (
                            <span className="ml-1 text-amber-500/60">(estimated)</span>
                          )}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-600">
                        Hour {hoveredItem.entry.hour}:00, Position {hoveredItem.entry.position}
                      </p>
                    </div>
                  </div>
                )}
                {hoveredItem && hoveredItem.kind === 'dj' && (
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        (DJ_COLORS[hoveredItem.segment.segment_type] ?? DJ_COLORS.show_intro).bg
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-bold text-white uppercase tracking-wide">
                          {hoveredItem.segment.segment_type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-gray-600">·</span>
                        <span className="text-xs text-gray-500 font-mono">
                          {formatDur(hoveredItem.durationSec)}
                        </span>
                        {hoveredItem.segment.audio_url ? (
                          <>
                            <span className="text-gray-600">·</span>
                            <span className="text-xs text-emerald-500">has audio · click to play</span>
                          </>
                        ) : (
                          <>
                            <span className="text-gray-600">·</span>
                            <span className="text-xs text-gray-600">no audio yet</span>
                          </>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 leading-relaxed line-clamp-2">
                        {hoveredItem.segment.edited_text ?? hoveredItem.segment.script_text}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Vertical segment list ────────────────────────────────────────── */}
            <div className="px-4 sm:px-6 pb-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Full Show Rundown
              </h3>
              <div className="space-y-1">
                {(() => {
                  let cumSec = 0;
                  return timeline.map((item, i) => {
                    const startSec = cumSec;
                    cumSec += item.durationSec;
                    if (item.kind === 'gap') return null;

                    const startLabel = (() => {
                      const m = Math.floor(startSec / 60);
                      const s = Math.round(startSec % 60);
                      return `${m}:${String(s).padStart(2, '0')}`;
                    })();

                    if (item.kind === 'dj') {
                      const { segment } = item;
                      const colors =
                        DJ_COLORS[segment.segment_type] ?? DJ_COLORS['show_intro'];
                      const isPlaying = playingSegmentId === segment.id;
                      return (
                        <div
                          key={`list-dj-${segment.id}`}
                          className="flex items-start gap-3 px-4 py-3 bg-[#1a1a2e] border border-[#2a2a40] rounded-xl"
                        >
                          <span className="text-gray-600 text-xs w-10 flex-shrink-0 pt-0.5 text-right font-mono">
                            {startLabel}
                          </span>
                          <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${colors.bg} opacity-80`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors.bg} ${colors.text}`}
                              >
                                {segment.segment_type.replace(/_/g, ' ')}
                              </span>
                              <span className="text-gray-500 text-xs font-mono">
                                {formatDur(item.durationSec)}
                              </span>
                            </div>
                            <p className="text-gray-400 text-xs mt-1 line-clamp-2">
                              {segment.edited_text ?? segment.script_text}
                            </p>
                          </div>
                          {segment.audio_url && (
                            <button
                              onClick={() => handlePlaySegment(segment)}
                              className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
                                isPlaying
                                  ? 'bg-violet-600 text-white'
                                  : 'text-gray-500 hover:text-violet-400 hover:bg-violet-900/20'
                              }`}
                              title={isPlaying ? 'Stop' : 'Play TTS audio'}
                            >
                              <svg
                                className="w-3.5 h-3.5"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                {isPlaying ? (
                                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                ) : (
                                  <path d="M8 5v14l11-7z" />
                                )}
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    }

                    if (item.kind === 'song') {
                      const { entry } = item;
                      return (
                        <div
                          key={`list-song-${entry.id}-${i}`}
                          className="flex items-center gap-3 px-4 py-3 bg-[#13131e] border border-[#252535] rounded-xl"
                        >
                          <span className="text-gray-600 text-xs w-10 flex-shrink-0 text-right font-mono">
                            {startLabel}
                          </span>
                          <div className="w-1 self-stretch rounded-full bg-slate-600 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <svg
                                className="w-3.5 h-3.5 text-slate-500 flex-shrink-0"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                              </svg>
                              <span className="text-gray-300 text-sm font-medium truncate">
                                {entry.song_title}
                              </span>
                              <span className="text-gray-500 text-xs truncate">
                                {entry.song_artist}
                              </span>
                            </div>
                          </div>
                          <span className="text-gray-600 text-xs flex-shrink-0 font-mono">
                            {formatDur(item.durationSec)}
                            {entry.duration_sec == null && (
                              <span className="ml-1 text-amber-500/60">est.</span>
                            )}
                          </span>
                        </div>
                      );
                    }

                    return null;
                  });
                })()}
              </div>
            </div>

            {/* ── Stats grid ──────────────────────────────────────────────────── */}
            <div className="px-4 sm:px-6 pb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: 'Est. Runtime',
                  value: formatTime(totalDurationSec),
                  sub: paddingSec > 0 ? `incl. ${paddingSec}s transitions` : 'no padding',
                },
                {
                  label: 'DJ Segments',
                  value: String(script.segments.length),
                  sub: `${djSegmentsWithAudio.length} with audio`,
                },
                {
                  label: 'Songs',
                  value: String(entries.length),
                  sub:
                    entries.filter((e) => e.duration_sec != null).length +
                    ' with known duration',
                },
                {
                  label: 'TTS Ready',
                  value: `${djSegmentsWithAudio.length}/${script.segments.length}`,
                  sub:
                    djSegmentsWithAudio.length === script.segments.length
                      ? 'All segments have audio'
                      : 'Generate missing TTS first',
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-[#13131a] border border-[#2a2a40] rounded-xl p-4"
                >
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">
                    {stat.label}
                  </p>
                  <p className="text-xl font-bold text-white font-mono leading-none">
                    {stat.value}
                  </p>
                  <p className="text-[10px] text-gray-600 mt-1">{stat.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
