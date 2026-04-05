'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

type DjReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'auto_approved';
type DjSegmentReviewStatus = 'pending' | 'approved' | 'edited' | 'rejected';
type DjSegmentType =
  | 'show_intro'
  | 'song_intro'
  | 'song_transition'
  | 'show_outro'
  | 'station_id'
  | 'time_check'
  | 'weather_tease'
  | 'ad_break';

export interface ReviewPanelSegment {
  id: string;
  playlist_entry_id: string | null;
  segment_type: DjSegmentType;
  position: number;
  script_text: string;
  edited_text: string | null;
  segment_review_status: DjSegmentReviewStatus;
  audio_url: string | null;
  audio_duration_sec: number | null;
}

export interface ReviewPanelScript {
  id: string;
  review_status: DjReviewStatus;
  llm_model: string;
  generation_ms: number | null;
  total_segments: number;
  segments: ReviewPanelSegment[];
}

export interface PlaylistEntry {
  id: string;
  hour: number;
  position: number;
  song_title: string;
  song_artist: string;
  duration_sec?: number | null;
}

interface Props {
  script: ReviewPanelScript;
  entries: PlaylistEntry[];
  playlistId: string;
  onScriptChange: (script: ReviewPanelScript | null) => void;
  onGenerating: (v: boolean) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEGMENT_STATUS_STYLES: Record<DjSegmentReviewStatus, string> = {
  pending: 'border-l-gray-600 border-[#2a2a40]',
  approved: 'border-l-green-500 border-green-900/20',
  edited: 'border-l-blue-500 border-blue-900/20',
  rejected: 'border-l-amber-500 border-amber-900/20',
};

const SEGMENT_STATUS_BADGE: Record<DjSegmentReviewStatus, { label: string; cls: string }> = {
  pending: { label: '', cls: '' },
  approved: { label: 'Approved', cls: 'text-green-400' },
  edited: { label: 'Edited', cls: 'text-blue-400' },
  rejected: { label: 'Rewriting…', cls: 'text-amber-400' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ScriptReviewPanel({
  script: initialScript,
  entries,
  playlistId,
  onScriptChange,
  onGenerating,
}: Props) {
  const [script, setScript] = useState<ReviewPanelScript>(initialScript);
  const [error, setError] = useState<string | null>(null);

  // Per-segment loading states
  const [approving, setApproving] = useState<Record<string, boolean>>({});
  const [rejecting, setRejecting] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  // Per-segment TTS states
  const [generatingTts, setGeneratingTts] = useState<Record<string, boolean>>({});
  const [deletingTts, setDeletingTts] = useState<Record<string, boolean>>({});
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Bulk TTS generation state
  const [bulkGeneratingTts, setBulkGeneratingTts] = useState(false);
  const [bulkTtsProgress, setBulkTtsProgress] = useState<{ done: number; total: number } | null>(null);

  // Inline editable text for all segments when pending_review
  const [segmentTexts, setSegmentTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (initialScript.segments ?? []).map((s) => [s.id, s.edited_text ?? s.script_text]),
    ),
  );

  // Re-sync segmentTexts when new script data arrives (e.g. after a rewrite)
  useEffect(() => {
    setSegmentTexts(
      Object.fromEntries(
        script.segments.map((s) => [s.id, s.edited_text ?? s.script_text]),
      ),
    );
  }, [script.id]);

  // Bulk action loading
  const [bulkApproving, setBulkApproving] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // Reject-all modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');

  // Per-segment instruction text for guided rewrites
  const [segmentInstructions, setSegmentInstructions] = useState<Record<string, string>>({});

  // Propagate local script changes to parent
  const updateScript = useCallback(
    (updated: ReviewPanelScript) => {
      setScript(updated);
      onScriptChange(updated);
    },
    [onScriptChange],
  );

  // Keep in sync if parent refreshes the script externally
  useEffect(() => {
    setScript(initialScript);
  }, [initialScript]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't fire when typing in a textarea/input
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      )
        return;

      // Find the first pending segment to operate on
      const firstPending = script.segments.find(
        (s) => s.segment_review_status === 'pending',
      );
      if (!firstPending) return;

      if (e.key === 'a') handleApproveSegment(firstPending.id);
      if (e.key === 'e') {
        setEditing(firstPending.id);
        setEditText(firstPending.edited_text ?? firstPending.script_text);
      }
      if (e.key === 'r') handleRejectSegment(firstPending.id);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script.segments]);

  // ── Per-segment actions ─────────────────────────────────────────────────

  async function handleApproveSegment(segmentId: string) {
    setApproving((p) => ({ ...p, [segmentId]: true }));
    setError(null);
    try {
      const updated = await api.post<ReviewPanelSegment>(
        `/api/v1/dj/segments/${segmentId}/approve`,
        {},
      );
      updateScript({
        ...script,
        segments: script.segments.map((s) =>
          s.id === segmentId ? { ...s, segment_review_status: updated.segment_review_status } : s,
        ),
      });
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to approve segment');
    } finally {
      setApproving((p) => { const n = { ...p }; delete n[segmentId]; return n; });
    }
  }

  async function handleRejectSegment(segmentId: string, instruction?: string) {
    setRejecting((p) => ({ ...p, [segmentId]: true }));
    setError(null);
    // Clear instruction input after submitting
    if (instruction) {
      setSegmentInstructions((p) => { const n = { ...p }; delete n[segmentId]; return n; });
    }
    try {
      // Mark as rejected locally to show spinner immediately
      setScript((prev) => ({
        ...prev,
        segments: prev.segments.map((s) =>
          s.id === segmentId ? { ...s, segment_review_status: 'rejected' } : s,
        ),
      }));
      const body = instruction ? { reason: instruction } : {};
      const updated = await api.post<ReviewPanelSegment>(
        `/api/v1/dj/segments/${segmentId}/reject`,
        body,
      );
      updateScript({
        ...script,
        segments: script.segments.map((s) =>
          s.id === segmentId ? { ...s, ...updated } : s,
        ),
      });
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to rewrite segment');
      // Revert rejected state on error
      setScript((prev) => ({
        ...prev,
        segments: prev.segments.map((s) =>
          s.id === segmentId ? { ...s, segment_review_status: 'pending' } : s,
        ),
      }));
    } finally {
      setRejecting((p) => { const n = { ...p }; delete n[segmentId]; return n; });
    }
  }

  async function handleSaveEdit(segmentId: string) {
    if (!editText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.put<ReviewPanelSegment>(
        `/api/v1/dj/segments/${segmentId}/text`,
        { text: editText },
      );
      updateScript({
        ...script,
        segments: script.segments.map((s) => (s.id === segmentId ? updated : s)),
      });
      setEditing(null);
      setEditText('');
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to save edit');
    } finally {
      setSaving(false);
    }
  }

  // ── Bulk actions ────────────────────────────────────────────────────────

  async function handleApproveAll() {
    setBulkApproving(true);
    setError(null);
    try {
      const updated = await api.post<ReviewPanelScript>(
        `/api/v1/dj/scripts/${script.id}/approve`,
        {},
      );
      updateScript({ ...script, review_status: updated.review_status });
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to approve script');
    } finally {
      setBulkApproving(false);
    }
  }

  /** Poll /dj/jobs/:jobId/status until completed or failed, then show result. */
  function pollJobUntilDone(jobId: string, oldScriptId: string) {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (safetyTimer) clearTimeout(safetyTimer);
    };

    pollTimer = setInterval(async () => {
      try {
        const status = await api.get<{
          state: string;
          pct: number;
          step: string;
          error: string | null;
          playlist_id: string;
        }>(`/api/v1/dj/jobs/${jobId}/status`);

        if (status.state === 'failed') {
          cleanup();
          onGenerating(false);
          onScriptChange(null);
          setError(status.error ?? 'Script generation failed. Check your LLM provider and API key settings.');
          return;
        }

        if (status.state === 'completed') {
          try {
            const refreshed = await api.get<ReviewPanelScript>(
              `/api/v1/dj/playlists/${playlistId}/script`,
            );
            if (refreshed && refreshed.total_segments > 0 && refreshed.id !== oldScriptId) {
              onScriptChange(refreshed);
            } else {
              onScriptChange(null);
              setError('Script was generated but has 0 segments. Check your LLM provider and API key settings.');
            }
          } catch {
            onScriptChange(null);
            setError('Generation completed but could not load the script. Please refresh.');
          }
          cleanup();
          onGenerating(false);
        }
      } catch {
        // poll error — keep trying (job status endpoint temporarily unavailable)
      }
    }, 2000);

    // Safety timeout: 3 minutes
    safetyTimer = setTimeout(() => {
      cleanup();
      onGenerating(false);
      onScriptChange(null);
      setError('Generation timed out after 3 minutes. Check your LLM provider and API key settings.');
    }, 180000);
  }

  async function handleRejectAll() {
    if (!rejectNotes.trim()) return;
    setReviewing(true);
    setError(null);
    const oldScriptId = script.id;
    try {
      const res = await api.post<ReviewPanelScript & { job_id?: string }>(
        `/api/v1/dj/scripts/${script.id}/reject`,
        { review_notes: rejectNotes },
      );
      onScriptChange(null);
      setShowRejectModal(false);
      setRejectNotes('');
      onGenerating(true);

      if (res.job_id) {
        pollJobUntilDone(res.job_id, oldScriptId);
      } else {
        // Fallback: old script-polling if no job_id returned
        const poll = setInterval(async () => {
          try {
            const refreshed = await api.get<ReviewPanelScript>(
              `/api/v1/dj/playlists/${playlistId}/script`,
            );
            if (refreshed && refreshed.total_segments > 0 && refreshed.id !== oldScriptId) {
              onScriptChange(refreshed);
              onGenerating(false);
              clearInterval(poll);
            }
          } catch { /* still generating */ }
        }, 3000);
        setTimeout(() => {
          clearInterval(poll);
          onGenerating(false);
          onScriptChange(null);
          setError('Generation timed out. Check your LLM provider and API key settings.');
        }, 180000);
      }
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Reject & rewrite failed');
    } finally {
      setReviewing(false);
    }
  }

  // ── Retry (for failed generations with 0 segments) ─────────────────────

  async function handleRetry() {
    setReviewing(true);
    setError(null);
    const oldScriptId = script.id;
    try {
      const res = await api.post<ReviewPanelScript & { job_id?: string }>(
        `/api/v1/dj/scripts/${script.id}/reject`,
        { review_notes: 'Retrying generation — previous attempt produced 0 segments.' },
      );
      onScriptChange(null);
      onGenerating(true);

      if (res.job_id) {
        pollJobUntilDone(res.job_id, oldScriptId);
      } else {
        // Fallback: old script-polling if no job_id returned
        const poll = setInterval(async () => {
          try {
            const refreshed = await api.get<ReviewPanelScript>(
              `/api/v1/dj/playlists/${playlistId}/script`,
            );
            if (refreshed && refreshed.total_segments > 0 && refreshed.id !== oldScriptId) {
              onScriptChange(refreshed);
              onGenerating(false);
              clearInterval(poll);
            }
          } catch { /* still generating */ }
        }, 3000);
        setTimeout(() => {
          clearInterval(poll);
          onGenerating(false);
          onScriptChange(null);
          setError('Generation timed out. Check your LLM provider and API key settings.');
        }, 180000);
      }
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Retry failed');
    } finally {
      setReviewing(false);
    }
  }

  // ── Per-segment TTS actions ─────────────────────────────────────────────

  async function handleGenerateTts(segmentId: string) {
    setGeneratingTts((p) => ({ ...p, [segmentId]: true }));
    setError(null);
    try {
      const updated = await api.post<ReviewPanelSegment>(
        `/api/v1/dj/segments/${segmentId}/regenerate-tts`,
        {},
      );
      updateScript({
        ...script,
        segments: script.segments.map((s) => s.id === segmentId ? { ...s, ...updated } : s),
      });
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'TTS generation failed');
    } finally {
      setGeneratingTts((p) => { const n = { ...p }; delete n[segmentId]; return n; });
    }
  }

  async function handleDeleteTts(segmentId: string) {
    setDeletingTts((p) => ({ ...p, [segmentId]: true }));
    // Stop playback if this segment is playing
    if (playingSegmentId === segmentId) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingSegmentId(null);
    }
    try {
      await api.delete(`/api/v1/dj/segments/${segmentId}/audio`);
      updateScript({
        ...script,
        segments: script.segments.map((s) =>
          s.id === segmentId ? { ...s, audio_url: null, audio_duration_sec: null } : s,
        ),
      });
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to delete audio');
    } finally {
      setDeletingTts((p) => { const n = { ...p }; delete n[segmentId]; return n; });
    }
  }

  function handlePlayTts(seg: ReviewPanelSegment) {
    if (!seg.audio_url) return;
    // If already playing this segment, pause it
    if (playingSegmentId === seg.id && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingSegmentId(null);
      return;
    }
    // Stop any currently playing segment
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    // Build absolute URL (audio_url is like /api/v1/dj/audio/...)
    const base = process.env.NEXT_PUBLIC_API_URL ?? '';
    const url = `${base}${seg.audio_url}`;
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingSegmentId(seg.id);
    audio.onended = () => { audioRef.current = null; setPlayingSegmentId(null); };
    audio.onerror = () => { audioRef.current = null; setPlayingSegmentId(null); };
    audio.play().catch(() => { audioRef.current = null; setPlayingSegmentId(null); });
  }

  // ── Bulk TTS generation ─────────────────────────────────────────────────

  async function handleGenerateAllTts() {
    const pending = script.segments.filter((s) => !s.audio_url);
    if (pending.length === 0) return;

    setBulkGeneratingTts(true);
    setBulkTtsProgress({ done: 0, total: pending.length });
    setError(null);

    let done = 0;
    let currentScript = script;

    for (const seg of pending) {
      try {
        const updated = await api.post<ReviewPanelSegment>(
          `/api/v1/dj/segments/${seg.id}/regenerate-tts`,
          {},
        );
        done++;
        setBulkTtsProgress({ done, total: pending.length });
        currentScript = {
          ...currentScript,
          segments: currentScript.segments.map((s) =>
            s.id === seg.id ? { ...s, ...updated } : s,
          ),
        };
        updateScript(currentScript);
      } catch {
        // One segment failed — continue with the rest
        done++;
        setBulkTtsProgress({ done, total: pending.length });
      }
    }

    setBulkGeneratingTts(false);
    setBulkTtsProgress(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const isPending = script.review_status === 'pending_review';
  const isFailed = isPending && script.total_segments === 0;

  return (
    <div>
      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Generation failed banner */}
      {isFailed && (
        <div className="mb-4 bg-red-900/20 border border-red-700/40 px-4 py-3 rounded-lg flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-red-400">Generation failed</p>
            <p className="text-xs text-red-500/80 mt-0.5">
              No segments were produced. Check that your LLM Provider and API key are correctly set in Settings, then retry.
            </p>
          </div>
          <button
            onClick={handleRetry}
            disabled={reviewing}
            className="btn-secondary text-xs border-red-700/50 text-red-400 hover:bg-red-900/30 shrink-0"
          >
            {reviewing ? 'Retrying…' : '↺ Retry Generation'}
          </button>
        </div>
      )}

      {/* Sticky header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 bg-[#13131a] p-4 rounded-xl border border-[#2a2a40] sticky top-0 z-10 shadow-lg">
        <div className="flex flex-col">
          <span
            className={`text-xs font-bold uppercase tracking-wider ${
              isFailed
                ? 'text-red-400'
                : script.review_status === 'approved' || script.review_status === 'auto_approved'
                ? 'text-green-400'
                : script.review_status === 'rejected'
                ? 'text-red-400'
                : 'text-yellow-400'
            }`}
          >
            {isFailed ? 'generation failed' : script.review_status.replace(/_/g, ' ')}
          </span>
          <span className="text-[10px] text-gray-500 mt-0.5">
            {script.total_segments} segments
            {script.generation_ms ? ` • ${(script.generation_ms / 1000).toFixed(1)}s` : ''}
            {` • ${script.llm_model}`}
            {isPending && !isFailed && !script.generation_ms ? ' • Audio generated after approval' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Generate All TTS — visible whenever some segments lack audio */}
          {!isFailed && script.segments.some((s) => !s.audio_url) && (
            <button
              onClick={handleGenerateAllTts}
              disabled={bulkGeneratingTts || bulkApproving}
              className="btn-secondary text-xs flex items-center gap-1.5 border-violet-900/50 text-violet-400 hover:bg-violet-900/20 disabled:opacity-50"
            >
              {bulkGeneratingTts ? (
                <>
                  <span className="w-3.5 h-3.5 inline-block border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                  {bulkTtsProgress
                    ? `Generating ${bulkTtsProgress.done + 1}/${bulkTtsProgress.total}…`
                    : 'Starting…'}
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 9a3 3 0 010 6m-3.536-6.464a5 5 0 000 7.072" />
                  </svg>
                  Generate All TTS
                </>
              )}
            </button>
          )}

          {isPending && !isFailed && (
            <>
              {/* Approve All */}
              <button
                onClick={handleApproveAll}
                disabled={bulkApproving || bulkGeneratingTts}
                className="btn-primary text-xs flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                {bulkApproving ? 'Approving…' : 'Approve All'}
              </button>

              {/* Reject All */}
              <button
                onClick={() => setShowRejectModal(true)}
                disabled={bulkApproving || bulkGeneratingTts}
                className="btn-secondary text-xs border-red-900/50 hover:bg-red-900/20 text-red-400 flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Reject All
              </button>
            </>
          )}
        </div>
      </div>

      {/* Segment list */}
      <div className="space-y-4">
        {script.segments.map((seg) => {
          const entry = entries.find((e) => e.id === seg.playlist_entry_id);
          const isRewriting = rejecting[seg.id] || seg.segment_review_status === 'rejected';
          const badge = SEGMENT_STATUS_BADGE[seg.segment_review_status];

          return (
            <div
              key={seg.id}
              className={`card p-5 border-l-4 transition-all ${SEGMENT_STATUS_STYLES[seg.segment_review_status]}`}
            >
              {/* Segment header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400 bg-violet-900/20 px-2 py-0.5 rounded border border-violet-500/10">
                    {seg.segment_type.replace(/_/g, ' ')}
                  </span>
                  {entry && (
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                      {entry.song_artist} — {entry.song_title}
                    </span>
                  )}
                  {badge.label && (
                    <span className={`text-[10px] font-bold uppercase flex items-center gap-1 ${badge.cls}`}>
                      {seg.segment_review_status === 'rejected' ? (
                        <span className="w-3 h-3 inline-block border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      ) : seg.segment_review_status === 'approved' ? (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      )}
                      {badge.label}
                    </span>
                  )}
                </div>

                {/* Per-segment action buttons — only when script is pending_review */}
                {isPending && !isRewriting && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Accept */}
                    <button
                      onClick={() => handleApproveSegment(seg.id)}
                      disabled={!!approving[seg.id]}
                      title="Approve segment"
                      className={`p-1.5 rounded-lg border text-xs font-bold transition-colors ${
                        seg.segment_review_status === 'approved'
                          ? 'bg-green-900/40 border-green-700/50 text-green-400'
                          : 'bg-[#1e1e2e] border-[#3a3a50] text-gray-400 hover:text-green-400 hover:border-green-700/50'
                      }`}
                    >
                      {approving[seg.id] ? (
                        <span className="w-3.5 h-3.5 inline-block border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>

                    {/* Reject / rewrite */}
                    <button
                      onClick={() => handleRejectSegment(seg.id, segmentInstructions[seg.id]?.trim() || undefined)}
                      title="Reject & rewrite (r)"
                      className="p-1.5 rounded-lg border bg-[#1e1e2e] border-[#3a3a50] text-gray-400 hover:text-red-400 hover:border-red-700/50 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* Rewriting spinner badge */}
                {isPending && isRewriting && (
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-amber-400">
                    <span className="w-3.5 h-3.5 inline-block border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    Rewriting…
                  </span>
                )}
              </div>

              {/* Script text / edit area */}
              {isPending && !isRewriting ? (
                <div className="space-y-1.5">
                  <textarea
                    value={segmentTexts[seg.id] ?? seg.edited_text ?? seg.script_text}
                    onChange={(e) =>
                      setSegmentTexts((prev) => ({ ...prev, [seg.id]: e.target.value }))
                    }
                    onBlur={async () => {
                      const newText = segmentTexts[seg.id] ?? '';
                      const original = seg.edited_text ?? seg.script_text;
                      if (newText === original) return;
                      setSaving(true);
                      try {
                        await api.put(`/api/v1/dj/segments/${seg.id}/text`, { text: newText });
                        updateScript({
                          ...script,
                          segments: script.segments.map((s) =>
                            s.id === seg.id
                              ? { ...s, edited_text: newText, segment_review_status: 'edited' }
                              : s,
                          ),
                        });
                      } catch {
                        setError('Failed to save edit');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    rows={Math.max(3, Math.ceil((segmentTexts[seg.id] ?? seg.edited_text ?? seg.script_text).length / 80))}
                    className="input w-full text-sm leading-relaxed resize-y"
                    placeholder="Script text…"
                  />
                  {saving && editing === seg.id && (
                    <p className="text-[10px] text-gray-500">Saving…</p>
                  )}
                </div>
              ) : editing === seg.id ? (
                <div className="space-y-3">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => handleSaveEdit(seg.id)}
                    rows={4}
                    className="input w-full text-sm leading-relaxed"
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => handleSaveEdit(seg.id)}
                      disabled={saving}
                      className="btn-primary text-xs py-1.5"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditing(null); setEditText(''); }}
                      className="btn-secondary text-xs py-1.5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                  {seg.edited_text ?? seg.script_text}
                </p>
              )}

              {/* Instruction input for guided rewrite */}
              {isPending && !isRewriting && (
                <div className="mt-4 pt-4 border-t border-[#2a2a40]">
                  <label className="text-[10px] font-bold uppercase text-gray-500 flex items-center gap-1 mb-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    Add instruction <span className="normal-case font-normal text-gray-600">(optional — guides the AI rewrite)</span>
                  </label>
                  <textarea
                    value={segmentInstructions[seg.id] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value.slice(0, 500);
                      setSegmentInstructions((p) => ({ ...p, [seg.id]: val }));
                    }}
                    placeholder="e.g. 'Make it more upbeat' or 'Mention the Grammy win'"
                    rows={2}
                    className="w-full bg-[#12121a] border border-[#2a2a40] rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 resize-none focus:outline-none focus:border-violet-600/60"
                  />
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-[10px] text-gray-600">
                      {(segmentInstructions[seg.id] ?? '').length}/500
                    </span>
                    {(segmentInstructions[seg.id] ?? '').trim() && (
                      <button
                        onClick={() => handleRejectSegment(seg.id, segmentInstructions[seg.id].trim())}
                        disabled={!!rejecting[seg.id]}
                        className="text-[11px] font-semibold px-3 py-1 rounded-lg bg-red-900/40 border border-red-700/50 text-red-400 hover:bg-red-800/40 transition-colors disabled:opacity-50"
                      >
                        {rejecting[seg.id] ? 'Rewriting…' : 'Reject with instruction'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── TTS Audio Controls ─────────────────────────────────── */}
              <div className="mt-3 pt-3 border-t border-[#2a2a40] flex items-center gap-2 flex-wrap">
                {seg.audio_url ? (
                  <>
                    {/* Play / Pause */}
                    <button
                      onClick={() => handlePlayTts(seg)}
                      className={`flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                        playingSegmentId === seg.id
                          ? 'bg-violet-600/30 border-violet-500/50 text-violet-200'
                          : 'bg-[#1a1a2a] border-[#2a2a40] text-gray-300 hover:border-violet-500/40 hover:text-violet-300'
                      }`}
                    >
                      {playingSegmentId === seg.id ? (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                      {playingSegmentId === seg.id ? 'Playing…' : 'Play'}
                      {seg.audio_duration_sec && (
                        <span className="text-gray-500">
                          {seg.audio_duration_sec < 60
                            ? `${Math.round(seg.audio_duration_sec)}s`
                            : `${Math.floor(seg.audio_duration_sec / 60)}:${String(Math.round(seg.audio_duration_sec % 60)).padStart(2, '0')}`}
                        </span>
                      )}
                    </button>

                    {/* Delete TTS */}
                    <button
                      onClick={() => handleDeleteTts(seg.id)}
                      disabled={!!deletingTts[seg.id]}
                      title="Delete generated audio"
                      className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-lg border bg-[#1a1a2a] border-[#2a2a40] text-gray-500 hover:text-red-400 hover:border-red-700/40 transition-colors disabled:opacity-40"
                    >
                      {deletingTts[seg.id] ? (
                        <span className="w-3 h-3 inline-block border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>

                    {/* Regenerate TTS (re-generate with current text) */}
                    <button
                      onClick={() => handleGenerateTts(seg.id)}
                      disabled={!!generatingTts[seg.id]}
                      title="Re-generate audio from current text"
                      className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-lg border bg-[#1a1a2a] border-[#2a2a40] text-gray-500 hover:text-violet-400 hover:border-violet-500/40 transition-colors disabled:opacity-40"
                    >
                      {generatingTts[seg.id] ? (
                        <span className="w-3 h-3 inline-block border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                    </button>
                  </>
                ) : (
                  /* Generate TTS */
                  <button
                    onClick={() => handleGenerateTts(seg.id)}
                    disabled={!!generatingTts[seg.id]}
                    className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border bg-[#1a1a2a] border-[#2a2a40] text-gray-400 hover:text-violet-300 hover:border-violet-500/40 transition-colors disabled:opacity-50"
                  >
                    {generatingTts[seg.id] ? (
                      <>
                        <span className="w-3 h-3 inline-block border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                        Generating audio…
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 9a3 3 0 010 6m-3.536-6.464a5 5 0 000 7.072" />
                        </svg>
                        Generate TTS
                      </>
                    )}
                  </button>
                )}
              </div>
              {/* ─────────────────────────────────────────────────────── */}

            </div>
          );
        })}
      </div>

      {/* Reject All modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Reject & Rewrite Script</h2>
            <p className="text-sm text-gray-400 mb-4">
              The entire script will be regenerated. Provide feedback to guide the rewrite.
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
                onClick={handleRejectAll}
                disabled={!rejectNotes.trim() || reviewing}
                className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {reviewing ? 'Rejecting…' : 'Reject & Rewrite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
