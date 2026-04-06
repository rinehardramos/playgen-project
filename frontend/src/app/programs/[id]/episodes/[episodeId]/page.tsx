'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDjPlayer } from '@/lib/DjPlayerContext';
import ScriptReviewPanel, { type ReviewPanelScript, type PlaylistEntry as ReviewPanelEntry } from '@/components/ScriptReviewPanel';
import ProgramPreviewModal from '@/components/ProgramPreviewModal';
import {
  buildTimeline,
  DJ_COLORS,
  SONG_STYLE,
  formatDurSec,
  type TimelineDjSegment,
  type TimelinePlaylistEntry,
} from '@/lib/timeline';

// ─── Local types ──────────────────────────────────────────────────────────────

type PlaylistStatus = 'draft' | 'generating' | 'ready' | 'approved' | 'exported' | 'failed';
type DjReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'auto_approved';

interface ProgramEpisode {
  id: string;
  program_id: string;
  playlist_id: string;
  air_date: string;
  episode_title: string | null;
  published_at: string | null;
}

interface Program {
  id: string;
  name: string;
  color_tag: string | null;
}

interface Playlist {
  id: string;
  date: string;
  status: PlaylistStatus;
  station_id: string;
  notes?: string;
}

interface PlaylistEntryWithSong extends TimelinePlaylistEntry {
  song_id: string;
  is_manual_override: boolean;
  category_label?: string;
  duration_sec: number | null;
}

// ReviewPanelScript is a superset of our local DjScript needs — reuse it directly
type DjScript = ReviewPanelScript;

type EpisodeTab = 'rundown' | 'music' | 'script' | 'preview';

const STATUS_STYLES: Record<PlaylistStatus, string> = {
  draft: 'bg-gray-800 text-gray-400',
  generating: 'bg-blue-900/30 text-blue-400 animate-pulse',
  ready: 'bg-yellow-900/30 text-yellow-400',
  approved: 'bg-green-900/30 text-green-400',
  exported: 'bg-violet-900/30 text-violet-400',
  failed: 'bg-red-900/30 text-red-400',
};

// ─── Rundown Tab ───────────────────────────────────────────────────────────���──

function RundownTab({
  script,
  entries,
}: {
  script: DjScript | null;
  entries: PlaylistEntryWithSong[];
}) {
  const { playSegment, currentSegment } = useDjPlayer();

  if (!script) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="mb-2">No DJ script generated yet.</p>
        <p className="text-sm text-gray-600">Go to the Script tab to generate one.</p>
      </div>
    );
  }

  const timeline = buildTimeline(script.segments, entries, 0);

  if (timeline.length === 0) {
    return <div className="text-center py-16 text-gray-600 text-sm">No content in rundown yet.</div>;
  }

  let cumSec = 0;

  return (
    <div className="space-y-1">
      {timeline.map((item, i) => {
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
          const colors = DJ_COLORS[segment.segment_type] ?? DJ_COLORS['show_intro'];
          const isPlaying = currentSegment?.id === segment.id;
          return (
            <div key={i} className="flex items-start gap-3 px-4 py-3 bg-[#1a1a2e] border border-[#2a2a40] rounded-xl">
              <span className="text-gray-600 text-xs w-10 flex-shrink-0 pt-0.5 text-right">{startLabel}</span>
              <div
                className={`w-1 self-stretch rounded-full flex-shrink-0`}
                style={{ backgroundColor: colors.bg.replace('bg-', '').includes('-') ? undefined : undefined }}
              >
                <div className={`w-full h-full rounded-full ${colors.bg} opacity-80`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors.bg} ${colors.text}`}>
                    {segment.segment_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-gray-500 text-xs">{formatDurSec(item.durationSec)}</span>
                  {segment.segment_review_status && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      segment.segment_review_status === 'approved' ? 'bg-green-900/30 text-green-400' :
                      segment.segment_review_status === 'rejected' ? 'bg-red-900/30 text-red-400' :
                      segment.segment_review_status === 'edited' ? 'bg-blue-900/30 text-blue-400' :
                      'bg-gray-800 text-gray-500'
                    }`}>
                      {segment.segment_review_status}
                    </span>
                  )}
                </div>
                <p className="text-gray-400 text-xs mt-1 line-clamp-2">
                  {segment.edited_text ?? segment.script_text}
                </p>
              </div>
              {segment.audio_url && (
                <button
                  onClick={() => playSegment({ id: segment.id, audioUrl: segment.audio_url!, segmentType: segment.segment_type, position: segment.position, djName: '', durationSec: segment.audio_duration_sec ?? null })}
                  className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
                    isPlaying ? 'bg-violet-600 text-white' : 'text-gray-500 hover:text-violet-400 hover:bg-violet-900/20'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    {isPlaying
                      ? <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                      : <path d="M8 5v14l11-7z"/>}
                  </svg>
                </button>
              )}
            </div>
          );
        }

        if (item.kind === 'song') {
          const { entry } = item;
          return (
            <div key={i} className="flex items-center gap-3 px-4 py-3 bg-[#13131e] border border-[#252535] rounded-xl">
              <span className="text-gray-600 text-xs w-10 flex-shrink-0 text-right">{startLabel}</span>
              <div className="w-1 self-stretch rounded-full bg-slate-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                  <span className="text-gray-300 text-sm font-medium truncate">{entry.song_title}</span>
                  <span className="text-gray-500 text-xs truncate">{entry.song_artist}</span>
                </div>
              </div>
              <span className="text-gray-600 text-xs flex-shrink-0">{formatDurSec(item.durationSec)}</span>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

// ─── Music Tab ────────────────────────────────────────────────────────────────

function MusicTab({ entries, playlistId }: { entries: PlaylistEntryWithSong[]; playlistId: string }) {
  const hours = Array.from(new Set(entries.map(e => e.hour))).sort((a, b) => a - b);
  return (
    <div className="space-y-4">
      {hours.map(hour => {
        const hourEntries = entries.filter(e => e.hour === hour).sort((a, b) => a.position - b.position);
        const label = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
        return (
          <div key={hour}>
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{label}</h3>
            <div className="space-y-1">
              {hourEntries.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 bg-[#1a1a2e] border border-[#2a2a40] rounded-lg">
                  <span className="text-gray-600 text-xs w-4 text-right">{entry.position}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-300 text-sm truncate">{entry.song_title}</span>
                      <span className="text-gray-500 text-xs truncate">{entry.song_artist}</span>
                    </div>
                    {entry.category_label && (
                      <span className="text-gray-600 text-xs">{entry.category_label}</span>
                    )}
                  </div>
                  {entry.is_manual_override && (
                    <span className="text-xs text-amber-500 bg-amber-900/20 px-1.5 py-0.5 rounded">override</span>
                  )}
                  {entry.duration_sec && (
                    <span className="text-gray-600 text-xs">{formatDurSec(entry.duration_sec)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EpisodeDetailPage() {
  const { id: programId, episodeId } = useParams<{ id: string; episodeId: string }>();
  const router = useRouter();

  const [episode, setEpisode] = useState<ProgramEpisode | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [entries, setEntries] = useState<PlaylistEntryWithSong[]>([]);
  const [script, setScript] = useState<DjScript | null>(null);
  const [tab, setTab] = useState<EpisodeTab>('rundown');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  const djPlayer = useDjPlayer();

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }
  }, [router]);

  // When the global DJ player fails to load a segment (404), clear its audio_url
  // so the UI reverts to the "Generate TTS" button.
  useEffect(() => {
    const failedId = djPlayer.lastErrorSegmentId;
    if (!failedId || !script) return;
    const seg = script.segments.find((s) => s.id === failedId);
    if (seg?.audio_url) {
      setScript((prev) =>
        prev
          ? {
              ...prev,
              segments: prev.segments.map((s) =>
                s.id === failedId ? { ...s, audio_url: null, audio_duration_sec: null } : s,
              ),
            }
          : prev,
      );
    }
  }, [djPlayer.lastErrorSegmentId, script]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ep = await api.get<unknown>(`/api/v1/program-episodes/${episodeId}`) as ProgramEpisode;
      setEpisode(ep);
      setEditTitle(ep.episode_title ?? '');

      const [prog, pl] = await Promise.all([
        api.get<unknown>(`/api/v1/programs/${ep.program_id}`) as Promise<Program>,
        api.get<unknown>(`/api/v1/playlists/${ep.playlist_id}`) as Promise<Playlist>,
      ]);
      setProgram(prog);
      setPlaylist(pl);

      const [ents, scripts] = await Promise.all([
        api.get<unknown>(`/api/v1/playlists/${ep.playlist_id}/entries`) as Promise<PlaylistEntryWithSong[]>,
        api.get<unknown>(`/api/v1/dj/scripts?playlist_id=${ep.playlist_id}`) as Promise<DjScript[]>,
      ]);
      setEntries(ents);
      setScript(scripts[0] ?? null);
    } catch {
      router.push(`/programs/${programId}`);
    } finally {
      setLoading(false);
    }
  }, [episodeId, programId, router]);

  useEffect(() => { load(); }, [load]);

  // Poll while playlist is generating
  useEffect(() => {
    if (playlist?.status !== 'generating') return;
    const t = setInterval(async () => {
      try {
        const pl = await api.get<unknown>(`/api/v1/playlists/${playlist.id}`) as Playlist;
        setPlaylist(pl);
        if (pl.status !== 'generating') {
          clearInterval(t);
          load();
        }
      } catch { clearInterval(t); }
    }, 3000);
    return () => clearInterval(t);
  }, [playlist?.status, playlist?.id, load]);

  async function saveTitle() {
    if (!episode) return;
    setSavingTitle(true);
    try {
      const updated = await api.put<unknown>(`/api/v1/program-episodes/${episode.id}`, { episode_title: editTitle || null }) as ProgramEpisode;
      setEpisode(updated);
    } finally {
      setSavingTitle(false);
    }
  }

  async function publishEpisode() {
    if (!episode) return;
    setPublishing(true);
    try {
      const updated = await api.post<unknown>(`/api/v1/program-episodes/${episode.id}/publish`, {}) as ProgramEpisode;
      setEpisode(updated);
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
      </div>
    );
  }

  if (!episode || !playlist || !program) return null;

  const dateLabel = new Date(episode.air_date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const previewEntries = entries.map(e => ({
    id: e.id,
    hour: e.hour,
    position: e.position,
    song_title: e.song_title,
    song_artist: e.song_artist,
    duration_sec: e.duration_sec,
  }));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb + header */}
      <div className="flex items-start gap-4 mb-6">
        <Link href={`/programs/${programId}`} className="text-gray-500 hover:text-gray-300 mt-1 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <nav className="text-xs text-gray-600 mb-1 flex items-center gap-1.5">
            <Link href="/programs" className="hover:text-gray-400">Programs</Link>
            <span>/</span>
            <Link href={`/programs/${programId}`} className="hover:text-gray-400">{program.name}</Link>
            <span>/</span>
            <span className="text-gray-500">Episode</span>
          </nav>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{dateLabel}</h1>
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[playlist.status]}`}>
              {playlist.status}
            </span>
            {episode.published_at && (
              <span className="text-xs text-green-400 bg-green-900/20 px-2 py-0.5 rounded">Published</span>
            )}
          </div>
          {/* Editable episode title */}
          <div className="flex items-center gap-2 mt-1.5">
            <input
              type="text"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); }}
              placeholder="Add episode title…"
              className="bg-transparent border-b border-[#2a2a40] focus:border-violet-500 text-gray-400 text-sm placeholder-gray-700 focus:outline-none pb-0.5 w-64 transition-colors"
            />
            {savingTitle && <span className="text-gray-600 text-xs">Saving…</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!episode.published_at && playlist.status === 'approved' && (
            <button
              onClick={publishEpisode}
              disabled={publishing}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          )}
          <button
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-2 bg-[#1a1a2e] hover:bg-[#252540] border border-[#2a2a40] text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.362a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
            </svg>
            Preview
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#12121f] rounded-lg p-1 mb-6 w-fit">
        {(['rundown', 'music', 'script', 'preview'] as EpisodeTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t
                ? 'bg-violet-600 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'script' ? 'DJ Script' : t === 'rundown' ? 'Rundown' : t === 'music' ? 'Music' : 'Preview'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'rundown' && (
        <RundownTab script={script} entries={entries} />
      )}

      {tab === 'music' && (
        <MusicTab entries={entries} playlistId={playlist.id} />
      )}

      {tab === 'script' && (
        <div>
          {!script ? (
            <div className="text-center py-16">
              <p className="text-gray-500 mb-4">No DJ script yet for this episode.</p>
              <button
                onClick={async () => {
                  setGeneratingScript(true);
                  try {
                    await api.post<unknown>('/api/v1/dj/scripts/generate', { playlist_id: playlist.id });
                    await load();
                  } finally {
                    setGeneratingScript(false);
                  }
                }}
                disabled={generatingScript || playlist.status === 'draft'}
                className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                {generatingScript ? 'Generating…' : 'Generate DJ Script'}
              </button>
              {playlist.status === 'draft' && (
                <p className="text-gray-600 text-xs mt-2">Approve the playlist first before generating a script.</p>
              )}
            </div>
          ) : (
            <ScriptReviewPanel
              script={script}
              entries={entries as ReviewPanelEntry[]}
              playlistId={playlist.id}
              onScriptChange={(updated) => { if (updated) setScript(updated); else load(); }}
              onGenerating={setGeneratingScript}
            />
          )}
        </div>
      )}

      {tab === 'preview' && script && (
        <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-6">
          <p className="text-gray-500 text-sm mb-4">
            Full show timeline with DJ segments and music interleaved in broadcast order.
          </p>
          <button
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            Open Full Preview
          </button>
        </div>
      )}
      {tab === 'preview' && !script && (
        <div className="text-center py-16 text-gray-500 text-sm">
          Generate a DJ script first to preview the full show.
        </div>
      )}

      {/* Full-screen preview modal */}
      {showPreview && script && (
        <ProgramPreviewModal
          script={script}
          entries={previewEntries}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
