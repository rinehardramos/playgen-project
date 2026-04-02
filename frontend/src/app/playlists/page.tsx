'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

type PlaylistStatus = 'draft' | 'generating' | 'ready' | 'approved' | 'exported' | 'failed';

interface Playlist {
  id: string;
  date: string; // ISO date string YYYY-MM-DD
  status: PlaylistStatus;
  template_name?: string;
  station_id: string;
}

interface Station {
  id: string;
  name: string;
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
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchStations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (selectedStation) {
      fetchPlaylists();
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
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load playlists');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const [year, month] = selectedMonth.split('-').map(Number);
      await api.post<void>(`/api/v1/stations/${selectedStation}/playlists/generate/month`, {
        year,
        month,
      });
      await fetchPlaylists();
    } catch (err: unknown) {
      setGenerateError((err as ApiError).message ?? 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  function prevMonth() {
    const [year, month] = selectedMonth.split('-').map(Number);
    const d = new Date(year, month - 2, 1);
    setSelectedMonth(getMonthKey(d));
  }

  function nextMonth() {
    const [year, month] = selectedMonth.split('-').map(Number);
    const d = new Date(year, month, 1);
    setSelectedMonth(getMonthKey(d));
  }

  // Group playlists by date for calendar-style display
  const playlistsByDate = new Map<string, Playlist>();
  playlists.forEach((p) => playlistsByDate.set(p.date, p));

  // Build all days in the selected month
  const [selYear, selMonth] = selectedMonth.split('-').map(Number);
  const daysInMonth = new Date(selYear, selMonth, 0).getDate();
  const allDays = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    return `${selYear}-${String(selMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Playlists</h1>
        <button
          onClick={handleGenerate}
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
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Month picker */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={prevMonth}
          className="btn-secondary px-3"
          aria-label="Previous month"
        >
          &larr;
        </button>
        <span className="text-sm font-semibold text-white min-w-[140px] text-center">
          {monthLabel(selectedMonth)}
        </span>
        <button
          onClick={nextMonth}
          className="btn-secondary px-3"
          aria-label="Next month"
        >
          &rarr;
        </button>
      </div>

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
            return (
              <div
                key={date}
                className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-[#1c1c28] border border-[#2a2a40] hover:bg-[#24243a] transition-colors"
              >
                <span className="text-sm text-gray-400 w-48">{formatDateLabel(date)}</span>
                {playlist ? (
                  <div className="flex items-center gap-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[playlist.status]}`}
                    >
                      {playlist.status}
                    </span>
                    {playlist.template_name && (
                      <span className="text-xs text-gray-500">{playlist.template_name}</span>
                    )}
                    <Link
                      href={`/playlists/${playlist.id}`}
                      className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                    >
                      View &rarr;
                    </Link>
                  </div>
                ) : (
                  <span className="text-xs text-gray-600 italic">No playlist</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
