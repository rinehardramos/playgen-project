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
}

interface PlaylistEntry {
  id: string;
  hour: number;
  position: number;
  category_name: string;
  song_id: string;
  title: string;
  artist: string;
  is_override: boolean;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  category_id: string;
}

const STATUS_STYLES: Record<PlaylistStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  generating: 'bg-blue-100 text-blue-700',
  ready: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  exported: 'bg-indigo-100 text-indigo-700',
  failed: 'bg-red-100 text-red-700',
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

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

  // Override modal state
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
      const [pl, entriesData] = await Promise.all([
        api.get<Playlist>(`/api/v1/playlists/${playlistId}`),
        api.get<PlaylistEntry[]>(`/api/v1/playlists/${playlistId}/entries`),
      ]);
      setPlaylist(pl);
      setEntries(entriesData);
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
      await api.put<Playlist>(`/api/v1/playlists/${playlistId}`, { status: 'approved' });
      setPlaylist((prev) => prev ? { ...prev, status: 'approved' } : prev);
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
      await api.put<PlaylistEntry>(`/api/v1/playlists/${playlistId}/entries/${overrideEntry.id}`, {
        song_id: song.id,
        is_override: true,
      });
      setEntries((prev) =>
        prev.map((e) =>
          e.id === overrideEntry.id
            ? { ...e, song_id: song.id, title: song.title, artist: song.artist, is_override: true }
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
      <div className="flex justify-center items-center min-h-screen">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !playlist) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  // Group entries by hour for display
  const byHour = new Map<number, PlaylistEntry[]>();
  entries.forEach((e) => {
    const arr = byHour.get(e.hour) ?? [];
    arr.push(e);
    byHour.set(e.hour, arr);
  });
  const hours = Array.from(byHour.keys()).sort((a, b) => a - b);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/playlists" className="text-sm text-gray-500 hover:text-gray-700">
            &larr; Playlists
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {playlist?.date
                ? new Date(playlist.date + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : 'Playlist'}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              {playlist && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[playlist.status]}`}
                >
                  {playlist.status}
                </span>
              )}
              {playlist?.template_name && (
                <span className="text-xs text-gray-400">{playlist.template_name}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Export buttons */}
          {playlist && (
            <>
              <a
                href={`${BASE}/api/v1/playlists/${playlistId}/export?format=xlsx`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Export XLSX
              </a>
              <a
                href={`${BASE}/api/v1/playlists/${playlistId}/export?format=csv`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Export CSV
              </a>
            </>
          )}
          {playlist?.status === 'ready' && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="px-4 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {approving ? 'Approving…' : 'Approve'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Entries table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Hour', 'Position', 'Category', 'Title', 'Artist', 'Override', 'Actions'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {hours.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No entries found.
                </td>
              </tr>
            ) : (
              hours.map((hour) => {
                const hourEntries = (byHour.get(hour) ?? []).sort((a, b) => a.position - b.position);
                return (
                  <Fragment key={hour}>
                    {hourEntries.map((entry, idx) => (
                      <tr key={entry.id} className={`hover:bg-gray-50 ${entry.is_override ? 'bg-yellow-50' : ''}`}>
                        {idx === 0 ? (
                          <td
                            rowSpan={hourEntries.length}
                            className="px-4 py-3 font-medium text-gray-700 align-top border-r border-gray-100"
                          >
                            {hour}:00
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-gray-600">{entry.position}</td>
                        <td className="px-4 py-3 text-gray-600">{entry.category_name}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{entry.title}</td>
                        <td className="px-4 py-3 text-gray-600">{entry.artist}</td>
                        <td className="px-4 py-3">
                          {entry.is_override && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                              Override
                            </span>
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
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Override Song</h2>
            <p className="text-sm text-gray-500 mb-4">
              Replacing: <strong>{overrideEntry.title}</strong> by {overrideEntry.artist} (Hour{' '}
              {overrideEntry.hour}:00, Pos {overrideEntry.position})
            </p>

            {overrideError && (
              <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700">{overrideError}</p>
              </div>
            )}

            <div className="mb-3">
              <input
                type="text"
                placeholder="Search songs…"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {searching && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-52 overflow-y-auto">
                {searchResults.map((song) => (
                  <button
                    key={song.id}
                    onClick={() => handleOverride(song)}
                    disabled={overrideSubmitting}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors disabled:opacity-50"
                  >
                    <span className="font-medium text-gray-900">{song.title}</span>
                    <span className="text-gray-500"> — {song.artist}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setOverrideEntry(null)}
                className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
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
