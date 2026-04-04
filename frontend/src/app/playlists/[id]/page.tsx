'use client';

import { useEffect, useState, Fragment, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';
import { useDjPlayer } from '@/lib/DjPlayerContext';

type PlaylistStatus = 'draft' | 'generating' | 'ready' | 'approved' | 'exported' | 'failed';
type DjReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'auto_approved';
type DjSegmentType = 'show_intro' | 'song_intro' | 'song_transition' | 'show_outro' | 'station_id' | 'time_check' | 'weather_tease' | 'ad_break';

interface DjSegment {
  id: string;
  segment_type: DjSegmentType;
  position: number;
  script_text: string;
  edited_text: string | null;
  audio_url: string | null;
  audio_duration_sec: number | null;
}

interface DjScript {
  id: string;
  review_status: DjReviewStatus;
  llm_model: string;
  generation_ms: number | null;
  total_segments: number;
  segments: DjSegment[];
}

type TabView = 'playlist' | 'dj-script';

interface Playlist {
  id: string;
  date: string;
  status: PlaylistStatus;
  template_name?: string;
  station_id: string;
  notes?: string;
}

// Field names match what the backend actually returns
interface PlaylistEntry {
  id: string;
  hour: number;
  position: number;
  song_id: string;
  song_title: string;
  song_artist: string;
  category_label: string;
  is_manual_override: boolean;
}

interface PlaylistWithEntries extends Playlist {
  entries: PlaylistEntry[];
}

interface Song {
  id: string;
  title: string;
  artist: string;
  category_id: string;
}

const STATUS_STYLES: Record<PlaylistStatus, string> = {
  draft: 'bg-gray-800 text-gray-400',
  generating: 'bg-blue-900/30 text-blue-400 animate-pulse',
  ready: 'bg-yellow-900/30 text-yellow-400',
  approved: 'bg-green-900/30 text-green-400',
  exported: 'bg-violet-900/30 text-violet-400',
  failed: 'bg-red-900/30 text-red-400',
};

// Empty string = relative URL so Vercel proxies /api/v1/* to the gateway.
// Set NEXT_PUBLIC_API_URL=https://www.playgen.site in production to make export
// links absolute (required for download prompts in some browsers).
const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function PlaylistDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const currentUser = getCurrentUser();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [entries, setEntries] = useState<PlaylistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const [overrideEntry, setOverrideEntry] = useState<PlaylistEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // DJ Script state
  const [activeTab, setActiveTab] = useState<TabView>('playlist');
  const [djScript, setDjScript] = useState<DjScript | null>(null);
  const [djLoading, setDjLoading] = useState(false);
  const [djError, setDjError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [editingSegment, setEditingSegment] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [regenLoading, setRegenLoading] = useState<Record<string, boolean>>({});
  const [regenError, setRegenError] = useState<Record<string, string>>({});

  const djPlayer = useDjPlayer();

  const fetchDjScript = useCallback(async () => {
    setDjLoading(true);
    setDjError(null);
    try {
      const script = await api.get<DjScript>(`/api/v1/dj/playlists/${playlistId}/script`);
      setDjScript(script);
    } catch (err: unknown) {
      const e = err as ApiError;
      if (e.status !== 404) setDjError(e.message ?? 'Failed to load DJ script');
      setDjScript(null);
    } finally {
      setDjLoading(false);
    }
  }, [playlistId]);

  async function handleGenerateScript() {
    if (!playlist) return;
    setGenerating(true);
    setDjError(null);
    try {
      await api.post(`/api/v1/dj/playlists/${playlistId}/generate`, {
        playlist_id: playlistId,
      });
      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const script = await api.get<DjScript>(`/api/v1/dj/playlists/${playlistId}/script`);
          // Wait until generation_ms is set — indicates worker finished (including TTS)
          if (script && script.total_segments > 0 && script.generation_ms != null) {
            setDjScript(script);
            setGenerating(false);
            clearInterval(poll);
          }
        } catch { /* still generating */ }
      }, 3000);
      // Safety timeout
      setTimeout(() => { clearInterval(poll); setGenerating(false); }, 120000);
    } catch (err: unknown) {
      setDjError((err as ApiError).message ?? 'Failed to generate script');
      setGenerating(false);
    }
  }

  async function handleReviewAction(action: 'approve' | 'reject') {
    if (!djScript) return;
    setReviewing(true);
    setDjError(null);
    try {
      const body: Record<string, unknown> = { action };
      if (action === 'reject') body.review_notes = rejectNotes;
      const updated = await api.post<DjScript>(`/api/v1/dj/scripts/${djScript.id}/review`, body);
      if (action === 'reject') {
        // Re-generation queued, start polling
        setDjScript(null);
        setShowRejectModal(false);
        setRejectNotes('');
        setGenerating(true);
        const poll = setInterval(async () => {
          try {
            const script = await api.get<DjScript>(`/api/v1/dj/playlists/${playlistId}/script`);
            if (script && script.total_segments > 0 && script.generation_ms != null && script.id !== djScript.id) {
              setDjScript(script);
              setGenerating(false);
              clearInterval(poll);
            }
          } catch { /* still generating */ }
        }, 3000);
        setTimeout(() => { clearInterval(poll); setGenerating(false); }, 120000);
      } else {
        setDjScript({ ...djScript, review_status: updated.review_status });
      }
    } catch (err: unknown) {
      setDjError((err as ApiError).message ?? 'Review action failed');
    } finally {
      setReviewing(false);
    }
  }

  async function handleSaveEdit(segmentId: string) {
    if (!djScript) return;
    try {
      const updated = await api.post<DjScript>(`/api/v1/dj/scripts/${djScript.id}/review`, {
        action: 'edit',
        edited_segments: [{ id: segmentId, edited_text: editText }],
      });
      setDjScript(updated);
      setEditingSegment(null);
      setEditText('');
    } catch (err: unknown) {
      setDjError((err as ApiError).message ?? 'Failed to save edit');
    }
  }

  async function handleRegenTts(segmentId: string) {
    setRegenLoading((prev) => ({ ...prev, [segmentId]: true }));
    setRegenError((prev) => { const next = { ...prev }; delete next[segmentId]; return next; });
    try {
      const updated = await api.post<DjSegment>(
        `/api/v1/dj/segments/${segmentId}/regenerate-tts`,
        {},
      );
      setDjScript((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          segments: prev.segments.map((s) =>
            s.id === segmentId
              ? { ...s, audio_url: updated.audio_url, audio_duration_sec: updated.audio_duration_sec }
              : s,
          ),
        };
      });
    } catch (err: unknown) {
      setRegenError((prev) => ({
        ...prev,
        [segmentId]: (err as ApiError).message ?? 'Failed to regenerate audio',
      }));
    } finally {
      setRegenLoading((prev) => { const next = { ...prev }; delete next[segmentId]; return next; });
    }
  }

  function resolveAudioUrl(audioUrl: string): string {
    return `${BASE}${audioUrl.startsWith('/api') ? '' : '/api/v1'}${audioUrl}`;
  }

  function segmentToPlayerFormat(seg: DjSegment, djName: string) {
    return {
      id: seg.id,
      segmentType: seg.segment_type,
      position: seg.position,
      djName,
      audioUrl: resolveAudioUrl(seg.audio_url!),
      durationSec: seg.audio_duration_sec,
    };
  }

  function playSegment(seg: DjSegment) {
    if (!seg.audio_url) return;
    const djName = djScript?.llm_model ? 'DJ' : 'DJ';
    djPlayer.playSegment(segmentToPlayerFormat(seg, djName));
  }

  function playAllSegments() {
    if (!djScript) return;
    const segsWithAudio = djScript.segments.filter((s) => s.audio_url);
    if (segsWithAudio.length === 0) return;
    const djName = 'DJ';
    djPlayer.playQueue(segsWithAudio.map((s) => segmentToPlayerFormat(s, djName)));
  }

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchPlaylist();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  useEffect(() => {
    if (activeTab === 'dj-script' && !djScript && !djLoading) {
      fetchDjScript();
    }
  }, [activeTab, djScript, djLoading, fetchDjScript]);

  async function fetchPlaylist() {
    setLoading(true);
    setError(null);
    try {
      // GET /playlists/:id returns { ...playlist, entries: [...] }
      const data = await api.get<PlaylistWithEntries>(`/api/v1/playlists/${playlistId}`);
      const { entries: e, ...pl } = data;
      setPlaylist(pl);
      setEntries(e ?? []);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load playlist');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!playlist) return;
    setApproving(true);
    try {
      // POST /playlists/:id/approve
      const updated = await api.post<Playlist>(`/api/v1/playlists/${playlistId}/approve`, {});
      setPlaylist(updated);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to approve playlist');
    } finally {
      setApproving(false);
    }
  }

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (!query.trim() || !playlist) return;
    setSearching(true);
    try {
      const results = await api.get<Song[]>(
        `/api/v1/stations/${playlist.station_id}/songs?q=${encodeURIComponent(query)}`
      );
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleOverride(song: Song) {
    if (!overrideEntry) return;
    setOverrideSubmitting(true);
    setOverrideError(null);
    try {
      // PUT /playlists/:id/entries/:hour/:position with { song_id }
      const updated = await api.put<PlaylistEntry>(
        `/api/v1/playlists/${playlistId}/entries/${overrideEntry.hour}/${overrideEntry.position}`,
        { song_id: song.id }
      );
      setEntries((prev) =>
        prev.map((e) =>
          e.hour === overrideEntry.hour && e.position === overrideEntry.position
            ? updated
            : e
        )
      );
      setOverrideEntry(null);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err: unknown) {
      setOverrideError((err as ApiError).message ?? 'Override failed');
    } finally {
      setOverrideSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-[#0b0b10]">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !playlist) {
    return (
      <div className="p-6 md:p-8">
        <div className="bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  const byHour = new Map<number, PlaylistEntry[]>();
  entries.forEach((e) => {
    const arr = byHour.get(e.hour) ?? [];
    arr.push(e);
    byHour.set(e.hour, arr);
  });
  const hours = Array.from(byHour.keys()).sort((a, b) => a - b);

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Link href="/playlists" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            ← Playlists
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">
              {playlist?.date
                ? new Date(playlist.date.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  })
                : 'Playlist'}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              {playlist && (
                <span className={`badge capitalize ${STATUS_STYLES[playlist.status]}`}>
                  {playlist.status}
                </span>
              )}
              {playlist?.template_name && (
                <span className="text-xs text-gray-500">{playlist.template_name}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {playlist && (
            <>
              <a
                href={`${BASE}/api/v1/playlists/${playlistId}/export/xlsx`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-sm"
              >
                Export XLSX
              </a>
              <a
                href={`${BASE}/api/v1/playlists/${playlistId}/export/csv`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-sm"
              >
                Export CSV
              </a>
            </>
          )}
          {playlist?.status === 'ready' && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {approving ? 'Approving…' : 'Approve'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-[#2a2a40]">
        <button
          onClick={() => setActiveTab('playlist')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'playlist'
              ? 'border-violet-500 text-violet-300'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Playlist
        </button>
        <button
          onClick={() => setActiveTab('dj-script')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'dj-script'
              ? 'border-violet-500 text-violet-300'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          DJ Script
          {djScript && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              djScript.review_status === 'approved' || djScript.review_status === 'auto_approved'
                ? 'bg-green-900/30 text-green-400'
                : djScript.review_status === 'rejected'
                ? 'bg-red-900/30 text-red-400'
                : 'bg-yellow-900/30 text-yellow-400'
            }`}>
              {djScript.review_status.replace('_', ' ')}
            </span>
          )}
        </button>
      </div>

      {/* DJ Script Tab */}
      {activeTab === 'dj-script' && (
        <div className="mb-6">
          {djError && (
            <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg text-sm">
              {djError}
            </div>
          )}

          {/* No script yet — generate button */}
          {!djScript && !djLoading && !generating && (
            <div className="card flex flex-col items-center justify-center py-16 gap-4">
              <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
              </svg>
              <p className="text-gray-500 text-sm">No DJ script has been generated for this playlist yet.</p>
              <button
                onClick={handleGenerateScript}
                className="btn-primary px-6 py-2.5 text-sm"
              >
                Generate DJ Script
              </button>
            </div>
          )}

          {/* Generating spinner */}
          {(djLoading || generating) && (
            <div className="card flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 text-sm">
                {generating ? 'Generating DJ script via OpenRouter...' : 'Loading script...'}
              </p>
            </div>
          )}

          {/* Script segments */}
          {djScript && !generating && (
            <>
              {/* Script header */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <span className={`badge capitalize ${
                    djScript.review_status === 'approved' || djScript.review_status === 'auto_approved'
                      ? 'bg-green-900/30 text-green-400'
                      : djScript.review_status === 'rejected'
                      ? 'bg-red-900/30 text-red-400'
                      : 'bg-yellow-900/30 text-yellow-400'
                  }`}>
                    {djScript.review_status.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-gray-500">
                    {djScript.total_segments} segments
                    {djScript.generation_ms ? ` | ${(djScript.generation_ms / 1000).toFixed(1)}s` : ''}
                    {` | ${djScript.llm_model}`}
                  </span>
                </div>

                {djScript.review_status === 'pending_review' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReviewAction('approve')}
                      disabled={reviewing}
                      className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                    >
                      {reviewing ? 'Approving...' : 'Approve Script'}
                    </button>
                    <button
                      onClick={() => setShowRejectModal(true)}
                      disabled={reviewing}
                      className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                    >
                      Reject & Rewrite
                    </button>
                  </div>
                )}

                {(djScript.review_status === 'approved' || djScript.review_status === 'auto_approved') && (
                  <button
                    onClick={handleGenerateScript}
                    className="btn-secondary text-sm"
                  >
                    Regenerate
                  </button>
                )}

                {/* Play All button — shown when any segment has audio */}
                {djScript.segments.some((s) => s.audio_url) && (
                  <button
                    onClick={playAllSegments}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Play All
                  </button>
                )}
              </div>

              {/* Segments list */}
              <div className="space-y-3">
                {djScript.segments.map((seg) => (
                  <div
                    key={seg.id}
                    className="card p-4 border border-[#2a2a40] hover:border-[#3a3a50] transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-violet-400 bg-violet-900/20 px-2 py-0.5 rounded">
                        {seg.segment_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-gray-600">#{seg.position + 1}</span>
                      {seg.audio_duration_sec != null && (
                        <span className="text-xs text-gray-600">{seg.audio_duration_sec}s</span>
                      )}
                      {seg.audio_url && (() => {
                        const isThisPlaying = djPlayer.currentSegment?.id === seg.id && djPlayer.isPlaying;
                        return (
                          <button
                            onClick={() => playSegment(seg)}
                            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600/20 hover:bg-violet-600/40 text-violet-400 text-xs font-medium transition-colors"
                          >
                            {isThisPlaying ? (
                              <>
                                <span className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                                Playing
                              </>
                            ) : (
                              <>
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                                Play
                              </>
                            )}
                          </button>
                        );
                      })()}
                    </div>

                    {editingSegment === seg.id ? (
                      <div>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={3}
                          className="input w-full mb-2 text-sm"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveEdit(seg.id)}
                            className="btn-primary text-xs px-3 py-1.5"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingSegment(null); setEditText(''); }}
                            className="btn-secondary text-xs px-3 py-1.5"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                          {seg.edited_text ?? seg.script_text}
                        </p>
                        {djScript.review_status === 'pending_review' && (
                          <button
                            onClick={() => {
                              setEditingSegment(seg.id);
                              setEditText(seg.edited_text ?? seg.script_text);
                            }}
                            className="text-xs text-violet-400 hover:text-violet-300 font-medium flex-shrink-0"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}

                    {seg.edited_text && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-gray-600 italic">Edited</p>
                        <button
                          onClick={() => handleRegenTts(seg.id)}
                          disabled={!!regenLoading[seg.id]}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600/20 hover:bg-violet-600/40 text-violet-400 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {regenLoading[seg.id] ? (
                            <>
                              <span className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                              Regenerating…
                            </>
                          ) : (
                            <>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Regenerate Audio
                            </>
                          )}
                        </button>
                        {regenError[seg.id] && (
                          <span className="text-xs text-red-400">{regenError[seg.id]}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Reject modal */}
          {showRejectModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
              <div className="w-full max-w-md bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
                <h2 className="text-lg font-semibold text-white mb-1">Reject & Rewrite Script</h2>
                <p className="text-sm text-gray-400 mb-4">
                  The script will be regenerated by the LLM. Provide feedback to guide the rewrite.
                </p>
                <textarea
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  placeholder="What should be different? (e.g. 'Too formal, make it more casual')"
                  rows={3}
                  className="input w-full mb-4"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowRejectModal(false); setRejectNotes(''); }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleReviewAction('reject')}
                    disabled={!rejectNotes.trim() || reviewing}
                    className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                  >
                    {reviewing ? 'Rejecting...' : 'Reject & Rewrite'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Entries table */}
      <div className={`card overflow-x-auto ${activeTab !== 'playlist' ? 'hidden' : ''}`}>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-[#13131a]">
              {['Hour', 'Pos', 'Category', 'Title', 'Artist', '', ''].map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-[#2a2a40]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-600">
                  No entries found.
                </td>
              </tr>
            ) : (
              hours.map((hour) => {
                const hourEntries = (byHour.get(hour) ?? []).sort((a, b) => a.position - b.position);
                return (
                  <Fragment key={hour}>
                    {hourEntries.map((entry, idx) => (
                      <tr
                        key={entry.id}
                        className={`border-b border-[#2a2a40] hover:bg-[#24243a] ${entry.is_manual_override ? 'bg-yellow-900/10' : ''}`}
                      >
                        {idx === 0 ? (
                          <td
                            rowSpan={hourEntries.length}
                            className="px-4 py-3 font-medium text-gray-400 align-top border-r border-[#2a2a40] whitespace-nowrap"
                          >
                            {hour}:00
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-gray-500">{entry.position}</td>
                        <td className="px-4 py-3 text-gray-400">{entry.category_label}</td>
                        <td className="px-4 py-3 font-medium text-white">{entry.song_title}</td>
                        <td className="px-4 py-3 text-gray-400">{entry.song_artist}</td>
                        <td className="px-4 py-3">
                          {entry.is_manual_override && (
                            <span className="badge bg-yellow-900/30 text-yellow-400">Override</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {playlist?.status !== 'approved' && playlist?.status !== 'exported' && (
                            <button
                              onClick={() => {
                                setOverrideEntry(entry);
                                setSearchQuery('');
                                setSearchResults([]);
                                setOverrideError(null);
                              }}
                              className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                            >
                              Override
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Override Modal */}
      {overrideEntry && activeTab === 'playlist' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Override Song</h2>
            <p className="text-sm text-gray-400 mb-4">
              Replacing: <span className="text-white font-medium">{overrideEntry.song_title}</span> by {overrideEntry.song_artist}
              {' '}(Hour {overrideEntry.hour}:00, Pos {overrideEntry.position})
            </p>

            {overrideError && (
              <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg text-sm">
                {overrideError}
              </div>
            )}

            <input
              type="text"
              placeholder="Search songs…"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="input mb-3"
            />

            {searching && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="border border-[#2a2a40] rounded-xl divide-y divide-[#2a2a40] max-h-52 overflow-y-auto mb-4">
                {searchResults.map((song) => (
                  <button
                    key={song.id}
                    onClick={() => handleOverride(song)}
                    disabled={overrideSubmitting}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#24243a] transition-colors disabled:opacity-50"
                  >
                    <span className="font-medium text-white">{song.title}</span>
                    <span className="text-gray-500"> — {song.artist}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setOverrideEntry(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
