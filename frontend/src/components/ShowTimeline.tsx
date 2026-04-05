'use client';

import { useRef, useState } from 'react';

export interface TimelineSegment {
  id: string;
  segment_type: string;
  position: number;
  script_text: string;
  edited_text: string | null;
  audio_url: string | null;
  audio_duration_sec: number | null;
}

interface ShowTimelineProps {
  segments: TimelineSegment[];
  /** Optional: show the "Export Audio List" CSV download button */
  showExport?: boolean;
}

const SEGMENT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  show_intro:       { bg: 'bg-violet-600',  border: 'border-violet-400',  text: 'text-violet-100' },
  song_intro:       { bg: 'bg-blue-600',    border: 'border-blue-400',    text: 'text-blue-100'   },
  song_transition:  { bg: 'bg-cyan-600',    border: 'border-cyan-400',    text: 'text-cyan-100'   },
  show_outro:       { bg: 'bg-purple-600',  border: 'border-purple-400',  text: 'text-purple-100' },
  station_id:       { bg: 'bg-amber-600',   border: 'border-amber-400',   text: 'text-amber-100'  },
  time_check:       { bg: 'bg-emerald-600', border: 'border-emerald-400', text: 'text-emerald-100'},
  weather_tease:    { bg: 'bg-sky-600',     border: 'border-sky-400',     text: 'text-sky-100'    },
  ad_break:         { bg: 'bg-orange-600',  border: 'border-orange-400',  text: 'text-orange-100' },
};

const DEFAULT_COLOR = { bg: 'bg-gray-600', border: 'border-gray-400', text: 'text-gray-100' };

/** Minimum width in px for a segment block so very short segments are still clickable */
const MIN_BLOCK_PX = 40;
/** Default assumed duration (seconds) for segments without audio */
const DEFAULT_DURATION_SEC = 15;

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export default function ShowTimeline({ segments, showExport = true }: ShowTimelineProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-500 text-sm">
        No segments to display.
      </div>
    );
  }

  const sorted = [...segments].sort((a, b) => a.position - b.position);

  // Total duration for proportional widths
  const totalDurationSec = sorted.reduce(
    (sum, s) => sum + (s.audio_duration_sec ?? DEFAULT_DURATION_SEC),
    0,
  );

  // Compute block widths. Each block is a percentage of total, but clamped to MIN_BLOCK_PX.
  // We render in a scrollable container so overflow is fine.
  const TOTAL_VISIBLE_PX = 900; // base canvas width (scrolls if wider)

  function blockWidthPx(seg: TimelineSegment): number {
    const dur = seg.audio_duration_sec ?? DEFAULT_DURATION_SEC;
    const pct = totalDurationSec > 0 ? dur / totalDurationSec : 1 / sorted.length;
    return Math.max(MIN_BLOCK_PX, Math.round(pct * TOTAL_VISIBLE_PX));
  }

  function exportCsv() {
    const rows = [
      ['position', 'segment_type', 'audio_filename', 'duration_sec'],
      ...sorted.map((s) => {
        const filename = s.audio_url
          ? s.audio_url.split('/').pop() ?? ''
          : '';
        return [
          String(s.position),
          s.segment_type,
          filename,
          String(s.audio_duration_sec ?? ''),
        ];
      }),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audio-list.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const hoveredSeg = hoveredId ? sorted.find((s) => s.id === hoveredId) : null;

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 font-medium">
            {sorted.length} segments &middot; {formatDuration(totalDurationSec)} total
          </span>
        </div>
        {showExport && (
          <button
            onClick={exportCsv}
            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Audio List
          </button>
        )}
      </div>

      {/* Timeline track */}
      <div
        ref={scrollRef}
        className="overflow-x-auto pb-2 relative"
        style={{ cursor: 'default' }}
      >
        <div
          className="flex items-stretch gap-1 h-16"
          style={{ minWidth: `${sorted.reduce((s, seg) => s + blockWidthPx(seg), 0) + sorted.length * 4}px` }}
        >
          {sorted.map((seg) => {
            const colors = SEGMENT_COLORS[seg.segment_type] ?? DEFAULT_COLOR;
            const w = blockWidthPx(seg);
            const isHovered = hoveredId === seg.id;
            const displayText = seg.edited_text ?? seg.script_text;

            return (
              <div
                key={seg.id}
                onMouseEnter={() => setHoveredId(seg.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`relative flex-shrink-0 rounded-md border ${colors.bg} ${colors.border} transition-all duration-150 ${
                  isHovered ? 'opacity-100 scale-y-110 shadow-lg z-10' : 'opacity-80'
                } flex flex-col justify-end overflow-hidden`}
                style={{ width: `${w}px` }}
                title={`${seg.segment_type.replace(/_/g, ' ')} · ${seg.audio_duration_sec != null ? formatDuration(seg.audio_duration_sec) : 'no audio'}`}
              >
                {/* Label inside block */}
                <div className={`px-1.5 py-1 ${colors.text}`}>
                  <p className="text-[9px] font-bold uppercase tracking-wider leading-none truncate">
                    {seg.segment_type.replace(/_/g, ' ')}
                  </p>
                  {seg.audio_duration_sec != null && (
                    <p className="text-[9px] font-mono opacity-70 mt-0.5 leading-none">
                      {formatDuration(seg.audio_duration_sec)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hover detail panel */}
      <div
        className={`rounded-xl border border-[#2a2a40] bg-[#13131a] p-4 transition-all duration-150 ${
          hoveredSeg ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ minHeight: '72px' }}
      >
        {hoveredSeg && (
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${(SEGMENT_COLORS[hoveredSeg.segment_type] ?? DEFAULT_COLOR).bg}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-xs font-bold text-white uppercase tracking-wide">
                  {hoveredSeg.segment_type.replace(/_/g, ' ')}
                </span>
                <span className="text-gray-600">·</span>
                <span className="text-xs text-gray-500 font-mono">
                  Position {hoveredSeg.position}
                </span>
                {hoveredSeg.audio_duration_sec != null && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span className="text-xs text-gray-400 font-mono">
                      {formatDuration(hoveredSeg.audio_duration_sec)}
                    </span>
                  </>
                )}
                {hoveredSeg.audio_url && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span className="text-xs text-emerald-500 font-medium">has audio</span>
                  </>
                )}
                {hoveredSeg.edited_text && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span className="text-xs text-blue-400 font-medium">edited</span>
                  </>
                )}
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                {truncate(hoveredSeg.edited_text ?? hoveredSeg.script_text, 200)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 pt-1">
        {Object.entries(SEGMENT_COLORS).map(([type, colors]) => {
          const exists = sorted.some((s) => s.segment_type === type);
          if (!exists) return null;
          return (
            <span key={type} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className={`w-2.5 h-2.5 rounded-sm ${colors.bg}`} />
              {type.replace(/_/g, ' ')}
            </span>
          );
        })}
      </div>
    </div>
  );
}
