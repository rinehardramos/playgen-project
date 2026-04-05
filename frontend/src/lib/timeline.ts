// Shared timeline building utility used by ProgramPreviewModal and the Episode Rundown tab.

export type DjSegmentType =
  | 'show_intro'
  | 'song_intro'
  | 'song_transition'
  | 'show_outro'
  | 'station_id'
  | 'time_check'
  | 'weather_tease'
  | 'ad_break'
  | 'adlib'
  | 'joke'
  | 'current_events'
  | 'listener_activity';

export interface TimelineDjSegment {
  id: string;
  playlist_entry_id: string | null;
  segment_type: DjSegmentType;
  position: number;
  script_text: string;
  edited_text: string | null;
  audio_url: string | null;
  audio_duration_sec: number | null;
  segment_review_status?: string;
}

export interface TimelinePlaylistEntry {
  id: string;
  hour: number;
  position: number;
  song_title: string;
  song_artist: string;
  duration_sec: number | null;
}

export type TimelineItem =
  | { kind: 'dj'; segment: TimelineDjSegment; durationSec: number }
  | { kind: 'song'; entry: TimelinePlaylistEntry; durationSec: number }
  | { kind: 'gap'; durationSec: number };

/** Default DJ segment duration when audio hasn't been generated yet (seconds) */
export const DEFAULT_DJ_SEC = 20;
/** Default song duration (3 min 30 s) when duration_sec is unknown */
export const DEFAULT_SONG_SEC = 210;

/**
 * Build an ordered list of DJ segments interleaved with songs.
 *
 * Ordering (mirrors generationWorker.ts logic):
 *   show_intro → song_intro → Song[0] → song_transition → Song[1] → … → show_outro
 *
 * After a `song_intro` or `song_transition`, the linked playlist entry plays.
 * A configurable padding gap is inserted between every item.
 */
export function buildTimeline(
  segments: TimelineDjSegment[],
  entries: TimelinePlaylistEntry[],
  paddingSec: number,
): TimelineItem[] {
  const sorted = [...segments].sort((a, b) => a.position - b.position);
  const sortedEntries = [...entries].sort((a, b) =>
    a.hour !== b.hour ? a.hour - b.hour : a.position - b.position,
  );

  const items: TimelineItem[] = [];

  for (const seg of sorted) {
    const durationSec = seg.audio_duration_sec ?? DEFAULT_DJ_SEC;

    if (items.length > 0 && paddingSec > 0) {
      items.push({ kind: 'gap', durationSec: paddingSec });
    }

    items.push({ kind: 'dj', segment: seg, durationSec });

    if (seg.segment_type === 'song_intro' || seg.segment_type === 'song_transition') {
      const linked = seg.playlist_entry_id
        ? sortedEntries.find((e) => e.id === seg.playlist_entry_id)
        : null;
      if (linked) {
        const songDur = linked.duration_sec ?? DEFAULT_SONG_SEC;
        if (paddingSec > 0) items.push({ kind: 'gap', durationSec: paddingSec });
        items.push({ kind: 'song', entry: linked, durationSec: songDur });
      }
    }
  }

  return items;
}

/** Colour palette for DJ segment types (bg / border / text Tailwind classes) */
export const DJ_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  show_intro:       { bg: 'bg-violet-700',  border: 'border-violet-500',  text: 'text-violet-100'  },
  song_intro:       { bg: 'bg-purple-700',  border: 'border-purple-500',  text: 'text-purple-100'  },
  song_transition:  { bg: 'bg-indigo-700',  border: 'border-indigo-500',  text: 'text-indigo-100'  },
  show_outro:       { bg: 'bg-violet-800',  border: 'border-violet-600',  text: 'text-violet-100'  },
  station_id:       { bg: 'bg-amber-700',   border: 'border-amber-500',   text: 'text-amber-100'   },
  time_check:       { bg: 'bg-emerald-700', border: 'border-emerald-500', text: 'text-emerald-100' },
  weather_tease:    { bg: 'bg-sky-700',     border: 'border-sky-500',     text: 'text-sky-100'     },
  ad_break:         { bg: 'bg-orange-700',  border: 'border-orange-500',  text: 'text-orange-100'  },
  adlib:            { bg: 'bg-teal-700',    border: 'border-teal-500',    text: 'text-teal-100'    },
  joke:             { bg: 'bg-pink-700',    border: 'border-pink-500',    text: 'text-pink-100'    },
  current_events:   { bg: 'bg-yellow-700',  border: 'border-yellow-500',  text: 'text-yellow-100'  },
  listener_activity:{ bg: 'bg-blue-700',    border: 'border-blue-500',    text: 'text-blue-100'    },
};

export const SONG_STYLE = {
  bg: 'bg-slate-700',
  border: 'border-slate-500',
  text: 'text-slate-200',
};

export function formatTimeSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDurSec(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
