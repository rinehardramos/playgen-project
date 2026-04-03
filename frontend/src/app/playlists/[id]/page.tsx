'use client';

import { useEffect, useState, Fragment } from 'react';
import { useRouter, useParams } from 'next/navigation';
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

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchPlaylist();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

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

      {/* Entries table */}
      <div className="card overflow-x-auto">
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
      {overrideEntry && (
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
