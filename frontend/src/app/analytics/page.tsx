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

interface HeatmapRow {
  song_id: string;
  title: string;
  artist: string;
  plays: Record<string, number>;
}

interface OverplayedRow {
  song_id: string;
  title: string;
  artist: string;
  avg_plays_per_day: number;
  threshold: number;
}

interface UnderplayedRow {
  song_id: string;
  title: string;
  artist: string;
  total_plays: number;
  last_played_at: string | null;
}

interface CategoryDistributionRow {
  category_code: string;
  category_label: string;
  total_plays: number;
  percentage: number;
}

function cellColor(count: number): string {
  if (count === 0) return 'bg-[#1c1c28] text-gray-600';
  if (count >= 3) return 'bg-red-900/30 text-red-400 font-semibold';
  if (count >= 2) return 'bg-yellow-900/30 text-yellow-400';
  return 'bg-green-900/30 text-green-400';
}

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

const BAR_COLORS = [
  'bg-violet-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-pink-500',
  'bg-orange-500',
  'bg-teal-500',
  'bg-red-500',
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AnalyticsPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const companyId = currentUser?.company_id ?? '';

  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [heatmap, setHeatmap] = useState<HeatmapRow[]>([]);
  const [overplayed, setOverplayed] = useState<OverplayedRow[]>([]);
  const [underplayed, setUnderplayed] = useState<UnderplayedRow[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Category distribution by date
  const [distDate, setDistDate] = useState<string>(todayIso());
  const [distribution, setDistribution] = useState<CategoryDistributionRow[]>([]);
  const [distLoading, setDistLoading] = useState(false);
  const [distError, setDistError] = useState<string | null>(null);

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
      fetchDistribution(selectedStation, distDate);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation]);

  async function fetchStations() {
    try {
      const data = await api.get<Station[]>(`/api/v1/companies/${companyId}/stations`);
      setStations(data);
      if (data.length > 0) setSelectedStation(data[0].id);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load stations');
    }
  }

  async function fetchAnalytics(stationId: string) {
    setLoading(true);
    setError(null);
    try {
      const [heatmapData, overplayedData, underplayedData] = await Promise.all([
        api.get<HeatmapRow[]>(`/api/v1/stations/${stationId}/analytics/heatmap?days=14`),
        api.get<OverplayedRow[]>(`/api/v1/stations/${stationId}/analytics/overplayed`),
        api.get<UnderplayedRow[]>(`/api/v1/stations/${stationId}/analytics/underplayed`),
      ]);

      // Build sorted dates from heatmap plays keys
      const dateSet = new Set<string>();
      heatmapData.forEach((row) => Object.keys(row.plays).forEach((d) => dateSet.add(d)));
      const sortedDates = Array.from(dateSet).sort();

      setHeatmap(heatmapData);
      setOverplayed(overplayedData);
      setUnderplayed(underplayedData);
      setDates(sortedDates);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  async function fetchDistribution(stationId: string, date: string) {
    setDistLoading(true);
    setDistError(null);
    try {
      const data = await api.get<CategoryDistributionRow[]>(
        `/api/v1/stations/${stationId}/analytics/category-distribution?date=${date}`,
      );
      setDistribution(data);
    } catch (err: unknown) {
      setDistError((err as ApiError).message ?? 'Failed to load distribution');
    } finally {
      setDistLoading(false);
    }
  }

  function handleDistDateChange(newDate: string) {
    setDistDate(newDate);
    if (selectedStation) fetchDistribution(selectedStation, newDate);
  }

  const hasData = heatmap.length > 0 || overplayed.length > 0 || underplayed.length > 0;

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Analytics</h1>
      </div>

      {stations.length > 1 && (
        <div className="mb-5">
          <label className="block text-sm text-gray-400 mb-1.5">Station</label>
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="input w-auto"
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
        <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* ── Category Distribution by Date ──────────────────────────────── */}
      {selectedStation && (
        <div className="card mb-8 p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Category Distribution</h2>
              <p className="text-xs text-gray-500 mt-0.5">Scheduled songs per category on a given day</p>
            </div>
            <input
              type="date"
              value={distDate}
              onChange={(e) => handleDistDateChange(e.target.value)}
              className="input text-sm w-auto"
            />
          </div>

          {distError && (
            <p className="text-xs text-red-400 mb-3">{distError}</p>
          )}

          {distLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : distribution.length === 0 ? (
            <p className="text-center text-gray-600 text-xs py-8">
              No playlist scheduled for this date.
            </p>
          ) : (
            <div className="space-y-2.5">
              {distribution.map((row, idx) => (
                <div key={row.category_code} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-28 truncate shrink-0">{row.category_label}</span>
                  <div className="flex-1 h-5 bg-[#1c1c28] rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${BAR_COLORS[idx % BAR_COLORS.length]} transition-all duration-500`}
                      style={{ width: `${row.percentage}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-300 w-16 text-right shrink-0">
                    {row.percentage}% <span className="text-gray-600 font-normal">({row.total_plays})</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : hasData ? (
        <>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mb-5 text-xs text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-green-900/30" /> 1 play
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-yellow-900/30" /> 2 plays
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-red-900/30" /> 3+ plays
            </span>
          </div>

          {/* Rotation Heatmap */}
          {heatmap.length > 0 && (
            <div className="card overflow-x-auto mb-8">
              <table className="min-w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#13131a]">
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase border-b border-[#2a2a40] min-w-[160px]">
                      Song
                    </th>
                    {dates.map((d) => (
                      <th
                        key={d}
                        className="px-1.5 py-2.5 text-center font-semibold text-gray-500 uppercase border-b border-[#2a2a40] w-10"
                      >
                        {shortDate(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.map((row) => (
                    <tr key={row.song_id} className="border-b border-[#2a2a40] hover:bg-[#24243a]">
                      <td className="px-3 py-2">
                        <p className="font-medium text-white truncate max-w-[150px]">{row.title}</p>
                        <p className="text-gray-500 truncate max-w-[150px]">{row.artist}</p>
                      </td>
                      {dates.map((d) => {
                        const count = row.plays[d] ?? 0;
                        return (
                          <td key={d} className="px-1 py-1 text-center">
                            <span
                              className={`inline-flex items-center justify-center w-8 h-8 rounded text-xs ${cellColor(count)}`}
                              title={`${count} plays`}
                            >
                              {count > 0 ? count : ''}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Overplayed + Underplayed */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h2 className="text-base font-semibold text-white mb-3">Overplayed Songs</h2>
              <div className="card overflow-hidden">
                <table className="min-w-full divide-y divide-[#2a2a40] text-sm">
                  <thead className="bg-[#13131a]">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Song</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Avg/Day</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Limit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2a2a40]">
                    {overplayed.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-gray-600 text-xs">
                          No overplayed songs.
                        </td>
                      </tr>
                    ) : (
                      overplayed.map((song) => (
                        <tr key={song.song_id} className="hover:bg-[#24243a]">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-white text-xs">{song.title}</p>
                            <p className="text-gray-500 text-xs">{song.artist}</p>
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs font-semibold text-red-400">
                            {song.avg_plays_per_day}
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs text-gray-500">
                            {song.threshold}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold text-white mb-3">Underplayed Songs</h2>
              <div className="card overflow-hidden">
                <table className="min-w-full divide-y divide-[#2a2a40] text-sm">
                  <thead className="bg-[#13131a]">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Song</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Plays (14d)</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Last Played</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2a2a40]">
                    {underplayed.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-gray-600 text-xs">
                          No underplayed songs.
                        </td>
                      </tr>
                    ) : (
                      underplayed.map((song) => (
                        <tr key={song.song_id} className="hover:bg-[#24243a]">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-white text-xs">{song.title}</p>
                            <p className="text-gray-500 text-xs">{song.artist}</p>
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs font-semibold text-yellow-400">
                            {song.total_plays}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-500">
                            {song.last_played_at
                              ? new Date(song.last_played_at).toLocaleDateString()
                              : 'Never'}
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
          <p className="text-center text-gray-600 py-16">
            {selectedStation ? 'No play history data yet.' : 'Select a station to view analytics.'}
          </p>
        )
      )}
    </div>
  );
}
