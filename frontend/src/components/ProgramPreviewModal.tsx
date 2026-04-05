'use client';

import { useState, useRef, useCallback } from 'react';
import {
  buildTimeline,
  DJ_COLORS,
  SONG_STYLE,
  formatTimeSec as formatTime,
  formatDurSec as formatDur,
  DEFAULT_DJ_SEC,
  DEFAULT_SONG_SEC,
  type TimelineItem,
  type TimelineDjSegment as DjSegment,
  type TimelinePlaylistEntry,
} from '@/lib/timeline';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DjScript {
  id: string;
  review_status: string;
  segments: DjSegment[];
  total_segments: number;
}

export interface PreviewPlaylistEntry extends TimelinePlaylistEntry {}

interface ProgramPreviewModalProps {
  script: DjScript;
  entries: PreviewPlaylistEntry[];
  onClose: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Pixels per second — drives proportional block widths */
const PX_PER_SEC = 4;
/** Minimum DJ block width so very short clips are still legible */
const MIN_DJ_PX = 80;
/** Minimum song block width */
const MIN_SONG_PX = 140;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blockPx(durationSec: number, min: number): number {
  return Math.max(min, Math.round(durationSec * PX_PER_SEC));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProgramPreviewModal({
  script,
  entries,
  onClose,
}: ProgramPreviewModalProps) {
  /** Transition padding between timeline blocks (seconds) */
  const [paddingSec, setPaddingSec] = useState(2);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);
  const [isPlayingAll, setIsPlayingAll] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playQueueRef = useRef<DjSegment[]>([]);
  const playIdxRef = useRef<number>(0);

  const timeline = buildTimeline(script.segments, entries, paddingSec);
  const totalDurationSec = timeline.reduce((s, item) => s + item.durationSec, 0);

  const djSegmentsWithAudio = script.segments
    .filter((s) => s.audio_url)
    .sort((a, b) => a.position - b.position);

  // ── Playback ────────────────────────────────────────────────────────────────

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
    audio.onerror = () => playNextInQueue(); // skip failed, continue queue
    audio.play().catch(() => playNextInQueue());
  }

  function handlePlayAll() {
    if (isPlayingAll) {
      stopPlayback();
      return;
    }
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
    audio.onended = () => { audioRef.current = null; setPlayingSegmentId(null); };
    audio.onerror = () => { audioRef.current = null; setPlayingSegmentId(null); };
    audio.play().catch(() => { audioRef.current = null; setPlayingSegmentId(null); });
  }

  // ── Download ────────────────────────────────────────────────────────────────

  function handleDownload() {
    const base = process.env.NEXT_PUBLIC_API_URL ?? '';
    const a = document.createElement('a');
    a.href = `${base}/api/v1/dj/scripts/${script.id}/audio`;
    a.download = `dj-script-${script.id.slice(0, 8)}.mp3`;
    a.click();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const hoveredItem = hoveredIdx !== null ? timeline[hoveredIdx] : null;

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0b10] overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#2a2a40] bg-[#13131a]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => { stopPlayback(); onClose(); }}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="w-px h-5 bg-[#2a2a40]" />
          <div>
            <h2 className="text-sm font-semibold text-white leading-none">Program Preview</h2>
            <p className="text-[10px] text-gray-500 mt-0.5 font-mono">
              {formatTime(totalDurationSec)} estimated runtime
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Play All (DJ segments only) */}
          <button
            onClick={handlePlayAll}
            disabled={djSegmentsWithAudio.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
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
                Stop
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Play DJ Audio
              </>
            )}
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={djSegmentsWithAudio.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#1a1a2a] border border-[#2a2a40] text-gray-300 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </button>

          {/* Publish — coming soon placeholder */}
          <button
            disabled
            title="Publishing coming soon"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#14141e] border border-[#1e1e30] text-gray-700 cursor-not-allowed select-none"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Publish
            <span className="text-[9px] uppercase tracking-wider text-gray-700">soon</span>
          </button>
        </div>
      </div>

      {/* ── Padding / transition control ───────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-4 px-6 py-3 border-b border-[#2a2a40] bg-[#0f0f18]">
        <svg className="w-4 h-4 text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
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
          className="w-36 accent-violet-500"
        />
        <span className="text-xs text-violet-300 font-mono w-8 text-right">{paddingSec}s</span>
        <span className="text-[10px] text-gray-600 hidden sm:block">
          Gap between each song and DJ segment — prevents dead air and abrupt cuts
        </span>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-4 text-[11px] text-gray-500 flex-shrink-0">
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

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Timeline track */}
        <div className="overflow-x-auto px-6 pt-6 pb-2">
          <div
            className="flex items-stretch h-28 rounded-xl overflow-hidden border border-[#2a2a40]"
            style={{ width: `${totalWidth}px`, minWidth: '100%' }}
          >
            {timeline.map((item, idx) => {
              // ── Gap block ─────────────────────────────────────────────────
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

              // ── Song block ───────────────────────────────────────────────
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
                    <div className="absolute inset-0 flex items-center gap-[2px] px-1 pointer-events-none" aria-hidden>
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
                    <div className={`absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-slate-900/80 to-transparent ${SONG_STYLE.text}`}>
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

              // ── DJ segment block ─────────────────────────────────────────
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
                    <div className="absolute top-2 left-2 flex gap-[3px] items-end h-4" aria-hidden>
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
                      <span className="text-[8px] text-white/30 uppercase tracking-wide">no audio</span>
                    </div>
                  )}

                  {/* Label */}
                  <div className={`absolute bottom-0 left-0 right-0 px-1.5 py-1.5 bg-gradient-to-t from-black/50 to-transparent ${colors.text}`}>
                    <p className="text-[9px] font-bold uppercase tracking-wider leading-none truncate">
                      {item.segment.segment_type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-[8px] font-mono opacity-60 leading-none mt-0.5">
                      {hasAudio ? formatDur(item.durationSec) : 'est. ' + formatDur(item.durationSec)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Hover detail panel ──────────────────────────────────────────── */}
        <div className="px-6 pt-3 pb-4">
          <div
            className={`rounded-xl border border-[#2a2a40] bg-[#13131a] p-4 transition-opacity duration-150 ${
              hoveredItem && hoveredItem.kind !== 'gap' ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            style={{ minHeight: '76px' }}
          >
            {hoveredItem && hoveredItem.kind === 'song' && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 bg-slate-500" />
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold text-white">{hoveredItem.entry.song_title}</span>
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
                    <span className="text-xs text-gray-500 font-mono">{formatDur(hoveredItem.durationSec)}</span>
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

        {/* ── Stats grid ──────────────────────────────────────────────────── */}
        <div className="px-6 pb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              sub: entries.filter((e) => e.duration_sec != null).length + ' with known duration',
            },
            {
              label: 'TTS Ready',
              value: `${djSegmentsWithAudio.length}/${script.segments.length}`,
              sub: djSegmentsWithAudio.length === script.segments.length ? 'All segments have audio' : 'Generate missing TTS first',
            },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#13131a] border border-[#2a2a40] rounded-xl p-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{stat.label}</p>
              <p className="text-xl font-bold text-white font-mono leading-none">{stat.value}</p>
              <p className="text-[10px] text-gray-600 mt-1">{stat.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
