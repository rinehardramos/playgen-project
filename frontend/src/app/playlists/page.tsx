'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

type PlaylistStatus = 'draft' | 'generating' | 'ready' | 'approved' | 'exported' | 'failed';

interface Playlist {
  id: string;
  date: string;
  status: PlaylistStatus;
  template_name?: string;
  station_id: string;
}

interface Station {
  id: string;
  name: string;
}

interface GenerateJob {
  date: string;
  job_id: string;
}

interface GenerationFailure {
  id: string;
  playlist_id: string | null;
  error_message: string | null;
  queued_at: string;
  triggered_by: string;
}

const STATUS_STYLES: Record<PlaylistStatus, string> = {
  draft: 'bg-gray-800 text-gray-400',
  generating: 'bg-blue-900/30 text-blue-400 animate-pulse',
  ready: 'bg-yellow-900/30 text-yellow-400',
  approved: 'bg-green-900/30 text-green-400',
  exported: 'bg-violet-900/30 text-violet-400',
  failed: 'bg-red-900/30 text-red-400',
};

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

export default function PlaylistsPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const companyId = currentUser?.company_id ?? '';

  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState<string>(getMonthKey(today));
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Month-batch generation state
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  // Per-day generation state: date -> 'pending' | 'done' | 'failed'
  const [dayGenerating, setDayGenerating] = useState<Record<string, boolean>>({});

  // Generation failure alert
  const [failures, setFailures] = useState<GenerationFailure[]>([]);
  const [failuresExpanded, setFailuresExpanded] = useState(false);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeJobsRef = useRef<GenerateJob[]>([]);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchStations();
    return () => stopPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (selectedStation) {
      fetchPlaylists();
      fetchFailures();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation, selectedMonth]);

  async function fetchStations() {
    try {
      const data = await api.get<Station[]>(`/api/v1/companies/${companyId}/stations`);
      setStations(data);
      if (data.length > 0) setSelectedStation(data[0].id);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load stations');
    }
  }

  async function fetchPlaylists() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Playlist[]>(
        `/api/v1/stations/${selectedStation}/playlists?month=${selectedMonth}`
      );
      setPlaylists(data);

      // Resume polling for any playlists still generating (e.g. user navigated away and back)
      const inProgress = data.filter((p) => p.status === 'generating');
      if (inProgress.length > 0 && activeJobsRef.current.length === 0) {
        const jobs = inProgress.map((p) => ({ date: p.date, job_id: 'resume' }));
        setDayGenerating((prev) => {
          const next = { ...prev };
          inProgress.forEach((p) => { next[p.date] = true; });
          return next;
        });
        startPolling(jobs);
      }
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load playlists');
    } finally {
      setLoading(false);
    }
  }

  async function fetchFailures() {
    try {
      const data = await api.get<{ data: GenerationFailure[]; count: number }>(
        `/api/v1/stations/${selectedStation}/generation-failures`
      );
      setFailures(data.data);
    } catch {
      // Non-critical — don't surface fetch errors for the failure badge
    }
  }

  // ── Per-day generation ────────────────────────────────────────────────────────

  async function handleGenerateDay(date: string) {
    setDayGenerating((prev) => ({ ...prev, [date]: true }));
    setGenerateError(null);
    try {
      const res = await api.post<{ job_id: string; playlist_id: string | null }>(
        `/api/v1/stations/${selectedStation}/playlists/generate`,
        { date }
      );
      // Start polling for this single job
      startPolling([{ date, job_id: res.job_id }]);
    } catch (err: unknown) {
      setGenerateError((err as ApiError).message ?? `Failed to generate ${date}`);
      setDayGenerating((prev) => ({ ...prev, [date]: false }));
    }
  }

  // ── Month-batch generation ────────────────────────────────────────────────────

  async function handleGenerateMonth() {
    setGenerating(true);
    setGenerateError(null);
    setBatchProgress(null);
    try {
      const [year, month] = selectedMonth.split('-').map(Number);
      const res = await api.post<{ queued: number; jobs: GenerateJob[] }>(
        `/api/v1/stations/${selectedStation}/playlists/generate/month`,
        { year, month }
      );
      if (res.queued === 0) {
        setGenerateError('All playlists for this month are already approved or generating.');
        setGenerating(false);
        return;
      }
      setBatchProgress({ done: 0, total: res.queued });
      startPolling(res.jobs);
    } catch (err: unknown) {
      setGenerateError((err as ApiError).message ?? 'Generation failed');
      setGenerating(false);
    }
  }

  // ── Polling ───────────────────────────────────────────────────────────────────

  function startPolling(jobs: GenerateJob[]) {
    activeJobsRef.current = jobs;
    stopPolling();
    pollRef.current = setInterval(() => pollJobs(), 2000);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function pollJobs() {
    if (!activeJobsRef.current.length) {
      stopPolling();
      return;
    }

    try {
      // Fetch latest playlist statuses for the current month
      const data = await api.get<Playlist[]>(
        `/api/v1/stations/${selectedStation}/playlists?month=${selectedMonth}`
      );
      setPlaylists(data);

      // Check if all active job dates have reached a terminal state
      const terminalStatuses: PlaylistStatus[] = ['ready', 'approved', 'exported', 'failed'];
      const playlistMap = new Map(data.map((p) => [p.date, p]));

      const pendingDates = activeJobsRef.current.filter((job) => {
        const pl = playlistMap.get(job.date);
        return !pl || !terminalStatuses.includes(pl.status);
      });

      // Count completed
      const doneDates = activeJobsRef.current.filter((job) => {
        const pl = playlistMap.get(job.date);
        return pl && terminalStatuses.includes(pl.status);
      });

      if (batchProgress) {
        setBatchProgress({ done: doneDates.length, total: activeJobsRef.current.length });
      }

      // Clear per-day spinner for completed dates
      const cleared: Record<string, boolean> = {};
      doneDates.forEach((job) => { cleared[job.date] = false; });
      setDayGenerating((prev) => ({ ...prev, ...cleared }));

      if (pendingDates.length === 0) {
        // All done
        stopPolling();
        activeJobsRef.current = [];
        setGenerating(false);
        setBatchProgress(null);
        setDayGenerating({});
      } else {
        activeJobsRef.current = pendingDates;
      }
    } catch {
      // Keep polling on transient errors
    }
  }

  function prevMonth() {
    const [year, month] = selectedMonth.split('-').map(Number);
    setSelectedMonth(getMonthKey(new Date(year, month - 2, 1)));
  }

  function nextMonth() {
    const [year, month] = selectedMonth.split('-').map(Number);
    setSelectedMonth(getMonthKey(new Date(year, month, 1)));
  }

  const playlistsByDate = new Map<string, Playlist>();
  playlists.forEach((p) => playlistsByDate.set(p.date.slice(0, 10), p));

  const [selYear, selMonth] = selectedMonth.split('-').map(Number);
  const daysInMonth = new Date(selYear, selMonth, 0).getDate();
  const allDays = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    return `${selYear}-${String(selMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Playlists</h1>
        <button
          onClick={handleGenerateMonth}
          disabled={!selectedStation || generating}
          className="btn-primary disabled:opacity-50"
        >
          {generating ? 'Generating…' : 'Generate Month'}
        </button>
      </div>

      {/* Station selector */}
      {stations.length > 1 && (
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1.5">Station</label>
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="input"
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Month picker */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={prevMonth} className="btn-secondary px-3" aria-label="Previous month">&larr;</button>
        <span className="text-sm font-semibold text-white min-w-[140px] text-center">
          {monthLabel(selectedMonth)}
        </span>
        <button onClick={nextMonth} className="btn-secondary px-3" aria-label="Next month">&rarr;</button>
      </div>

      {/* Batch progress bar */}
      {batchProgress && (
        <div className="mb-4 rounded-lg bg-[#1c1c28] border border-[#2a2a40] px-4 py-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-400">Generating playlists…</span>
            <span className="text-white font-medium">{batchProgress.done} / {batchProgress.total}</span>
          </div>
          <div className="w-full bg-[#2a2a40] rounded-full h-1.5">
            <div
              className="bg-violet-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Generation failure alert */}
      {failures.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-700/50 bg-red-900/20">
          <button
            onClick={() => setFailuresExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-red-400">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold">
                {failures.length}
              </span>
              {failures.length === 1 ? '1 generation failure' : `${failures.length} generation failures`} in the last 30 days
            </span>
            <span className="text-red-500 text-xs">{failuresExpanded ? '▲ Hide' : '▼ Details'}</span>
          </button>
          {failuresExpanded && (
            <ul className="border-t border-red-700/30 divide-y divide-red-700/20">
              {failures.map((f) => (
                <li key={f.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-red-300 font-mono truncate flex-1">
                      {f.error_message ?? 'Unknown error'}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">
                      {new Date(f.queued_at).toLocaleDateString()} · {f.triggered_by}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(error || generateError) && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{error ?? generateError}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {allDays.map((date) => {
            const playlist = playlistsByDate.get(date);
            const isDayGenerating = dayGenerating[date];

            return (
              <div
                key={date}
                className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-[#1c1c28] border border-[#2a2a40] hover:bg-[#24243a] transition-colors"
              >
                <span className="text-sm text-gray-400 w-48">{formatDateLabel(date)}</span>

                <div className="flex items-center gap-3">
                  {playlist ? (
                    <>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[playlist.status]}`}>
                        {playlist.status}
                      </span>
                      {playlist.template_name && (
                        <span className="text-xs text-gray-500">{playlist.template_name}</span>
                      )}
                      <Link
                        href={`/playlists/${playlist.id}`}
                        className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                      >
                        View →
                      </Link>
                      {/* Regenerate for failed/ready playlists */}
                      {(playlist.status === 'failed' || playlist.status === 'ready' || playlist.status === 'draft') && (
                        <button
                          onClick={() => handleGenerateDay(date)}
                          disabled={isDayGenerating || generating}
                          className="text-xs text-gray-500 hover:text-violet-400 disabled:opacity-40 font-medium transition-colors"
                        >
                          {isDayGenerating ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin inline-block" />
                              Generating
                            </span>
                          ) : 'Regenerate'}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => handleGenerateDay(date)}
                      disabled={isDayGenerating || generating}
                      className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-40 font-medium transition-colors"
                    >
                      {isDayGenerating ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin inline-block" />
                          Generating…
                        </span>
                      ) : '+ Generate'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
