'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface Station {
  id: string;
  name: string;
}

interface HeatmapEntry {
  song_id: string;
  title: string;
  artist: string;
  // Keys are ISO date strings (YYYY-MM-DD), values are play counts
  plays: Record<string, number>;
  weekly_limit?: number;
}

interface OverplayedSong {
  song_id: string;
  title: string;
  artist: string;
  play_count: number;
  limit: number;
}

interface UnderplayedSong {
  song_id: string;
  title: string;
  artist: string;
  play_count: number;
  expected: number;
}

interface AnalyticsData {
  dates: string[]; // last 14 days ISO date strings
  heatmap: HeatmapEntry[];
  overplayed: OverplayedSong[];
  underplayed: UnderplayedSong[];
}

function cellColor(count: number, limit: number | undefined): string {
  if (count === 0) return 'bg-[#1c1c28] text-gray-600';
  if (!limit) return 'bg-green-900/30 text-green-400';
  const ratio = count / limit;
  if (ratio >= 1) return 'bg-red-900/30 text-red-400 font-semibold';
  if (ratio >= 0.8) return 'bg-yellow-900/30 text-yellow-400';
  return 'bg-green-900/30 text-green-400';
}

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

export default function AnalyticsPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const companyId = currentUser?.company_id ?? '';

  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      fetchAnalytics(selectedStation);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation]);

  async function fetchStations() {
    try {
      const stations = await api.get<Station[]>(`/api/v1/companies/${companyId}/stations`);
      setStations(stations);
      if (stations.length > 0) setSelectedStation(stations[0].id);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load stations');
    }
  }

  async function fetchAnalytics(stationId: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<AnalyticsData>(
        `/api/v1/stations/${stationId}/analytics?days=14`
      );
      setData(result);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Analytics</h1>
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

      {error && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data ? (
        <>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-green-900/30" /> OK
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-yellow-900/30" /> Near limit (&ge;80%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-red-900/30" /> Over limit
            </span>
          </div>

          {/* Heatmap */}
          <div className="card overflow-x-auto mb-8">
            <table className="min-w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#13131a]">
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase border-b border-[#2a2a40] min-w-[160px]">
                    Song
                  </th>
                  {data.dates.map((d) => (
                    <th
                      key={d}
                      className="px-1.5 py-2 text-center font-semibold text-gray-500 uppercase border-b border-[#2a2a40] w-10"
                    >
                      {shortDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.heatmap.length === 0 ? (
                  <tr>
                    <td
                      colSpan={data.dates.length + 1}
                      className="px-3 py-12 text-center text-gray-600"
                    >
                      No data available.
                    </td>
                  </tr>
                ) : (
                  data.heatmap.map((row) => (
                    <tr key={row.song_id} className="hover:bg-[#24243a] border-b border-[#2a2a40]">
                      <td className="px-3 py-2">
                        <p className="font-medium text-white truncate max-w-[150px]">
                          {row.title}
                        </p>
                        <p className="text-gray-500 truncate max-w-[150px]">{row.artist}</p>
                      </td>
                      {data.dates.map((d) => {
                        const count = row.plays[d] ?? 0;
                        return (
                          <td key={d} className="px-1 py-1 text-center">
                            <span
                              className={`inline-flex items-center justify-center w-8 h-8 rounded text-xs ${cellColor(count, row.weekly_limit)}`}
                              title={`${count} plays${row.weekly_limit ? ` / limit ${row.weekly_limit}` : ''}`}
                            >
                              {count > 0 ? count : ''}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Two-column tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Overplayed */}
            <div>
              <h2 className="text-base font-semibold text-white mb-3">Overplayed Songs</h2>
              <div className="card overflow-hidden">
                <table className="min-w-full divide-y divide-[#2a2a40] text-sm">
                  <thead className="bg-[#13131a]">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">
                        Song
                      </th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">
                        Plays
                      </th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">
                        Limit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2a2a40]">
                    {data.overplayed.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-gray-600 text-xs">
                          No overplayed songs.
                        </td>
                      </tr>
                    ) : (
                      data.overplayed.map((song) => (
                        <tr key={song.song_id} className="hover:bg-[#24243a]">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-white text-xs">{song.title}</p>
                            <p className="text-gray-500 text-xs">{song.artist}</p>
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs font-semibold text-red-400">
                            {song.play_count}
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs text-gray-500">
                            {song.limit}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Underplayed */}
            <div>
              <h2 className="text-base font-semibold text-white mb-3">Underplayed Songs</h2>
              <div className="card overflow-hidden">
                <table className="min-w-full divide-y divide-[#2a2a40] text-sm">
                  <thead className="bg-[#13131a]">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">
                        Song
                      </th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">
                        Plays
                      </th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">
                        Expected
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2a2a40]">
                    {data.underplayed.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-gray-600 text-xs">
                          No underplayed songs.
                        </td>
                      </tr>
                    ) : (
                      data.underplayed.map((song) => (
                        <tr key={song.song_id} className="hover:bg-[#24243a]">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-white text-xs">{song.title}</p>
                            <p className="text-gray-500 text-xs">{song.artist}</p>
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs font-semibold text-yellow-400">
                            {song.play_count}
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs text-gray-500">
                            {song.expected}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : (
        !error && (
          <p className="text-center text-gray-600 py-16">Select a station to view analytics.</p>
        )
      )}
    </div>
  );
}
