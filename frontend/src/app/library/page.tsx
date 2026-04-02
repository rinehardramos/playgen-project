'use client';

import { useEffect, useState, useRef, FormEvent, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface Station {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  category_id: string;
  category_name?: string;
  eligible_hours?: string;
  is_active: boolean;
}

interface SongFormData {
  title: string;
  artist: string;
  category_id: string;
  eligible_hours: string;
}

const EMPTY_SONG_FORM: SongFormData = {
  title: '',
  artist: '',
  category_id: '',
  eligible_hours: '',
};

export default function LibraryPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();

  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add Song modal
  const [songModalOpen, setSongModalOpen] = useState(false);
  const [songForm, setSongForm] = useState<SongFormData>(EMPTY_SONG_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Import modal
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const companyId = currentUser?.company_id ?? '';

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
      fetchCategories(selectedStation);
      fetchSongs(selectedStation);
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

  async function fetchCategories(stationId: string) {
    try {
      const data = await api.get<Category[]>(`/api/v1/stations/${stationId}/categories`);
      setCategories(data);
    } catch {
      // Non-critical
    }
  }

  async function fetchSongs(stationId: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Song[]>(`/api/v1/stations/${stationId}/songs`);
      setSongs(data);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load songs');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddSong(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post<Song>(`/api/v1/stations/${selectedStation}/songs`, songForm);
      setSongModalOpen(false);
      setSongForm(EMPTY_SONG_FORM);
      await fetchSongs(selectedStation);
    } catch (err: unknown) {
      setFormError((err as ApiError).message ?? 'Failed to add song');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!importFile) return;
    setImportError(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      await api.postForm<{ imported: number }>(`/api/v1/stations/${selectedStation}/songs/import`, formData);
      setImportModalOpen(false);
      setImportFile(null);
      await fetchSongs(selectedStation);
    } catch (err: unknown) {
      setImportError((err as ApiError).message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function deactivateSong(songId: string) {
    try {
      await api.put<Song>(`/api/v1/songs/${songId}`, { is_active: false });
      setSongs((prev) => prev.map((s) => (s.id === songId ? { ...s, is_active: false } : s)));
    } catch (err: unknown) {
      alert((err as ApiError).message ?? 'Failed to deactivate song');
    }
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const filteredSongs = songs.filter((s) => {
    const matchSearch =
      !search ||
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.artist.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !categoryFilter || s.category_id === categoryFilter;
    return matchSearch && matchCategory;
  });

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Song Library</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportModalOpen(true)}
            disabled={!selectedStation}
            className="btn-secondary disabled:opacity-50"
          >
            Import XLSM
          </button>
          <button
            onClick={() => setSongModalOpen(true)}
            disabled={!selectedStation}
            className="btn-primary disabled:opacity-50"
          >
            + Add Song
          </button>
        </div>
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search title or artist…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-60"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="input"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-[#2a2a40] text-sm">
            <thead className="bg-[#13131a]">
              <tr>
                {['Title', 'Artist', 'Category', 'Eligible Hours', 'Status', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a40]">
              {filteredSongs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-600">
                    No songs found.
                  </td>
                </tr>
              ) : (
                filteredSongs.map((song) => (
                  <tr key={song.id} className="hover:bg-[#24243a] border-b border-[#2a2a40]">
                    <td className="px-4 py-3 font-medium text-white">{song.title}</td>
                    <td className="px-4 py-3 text-gray-400">{song.artist}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {song.category_name ?? categoryMap.get(song.category_id) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{song.eligible_hours ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          song.is_active
                            ? 'bg-green-900/30 text-green-400'
                            : 'bg-gray-800 text-gray-500'
                        }`}
                      >
                        {song.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {song.is_active && (
                        <button
                          onClick={() => deactivateSong(song.id)}
                          className="text-xs text-red-400 hover:text-red-300 font-medium"
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Song Modal */}
      {songModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">Add Song</h2>
            {formError && (
              <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                <p className="text-sm text-red-400">{formError}</p>
              </div>
            )}
            <form onSubmit={handleAddSong} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Title</label>
                <input
                  type="text"
                  required
                  value={songForm.title}
                  onChange={(e) => setSongForm((p) => ({ ...p, title: e.target.value }))}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Artist</label>
                <input
                  type="text"
                  required
                  value={songForm.artist}
                  onChange={(e) => setSongForm((p) => ({ ...p, artist: e.target.value }))}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Category</label>
                <select
                  required
                  value={songForm.category_id}
                  onChange={(e) => setSongForm((p) => ({ ...p, category_id: e.target.value }))}
                  className="input w-full"
                >
                  <option value="">Select a category…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Eligible Hours (e.g. 6-22)
                </label>
                <input
                  type="text"
                  value={songForm.eligible_hours}
                  onChange={(e) => setSongForm((p) => ({ ...p, eligible_hours: e.target.value }))}
                  className="input w-full"
                  placeholder="0-23"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSongModalOpen(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Add Song'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">Import XLSM</h2>
            {importError && (
              <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                <p className="text-sm text-red-400">{importError}</p>
              </div>
            )}
            <form onSubmit={handleImport} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Select XLSM file
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsm,.xlsx"
                  required
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setImportFile(e.target.files?.[0] ?? null)
                  }
                  className="block w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-violet-900/30 file:text-violet-400 hover:file:bg-violet-900/50"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importing || !importFile}
                  className="btn-primary disabled:opacity-50"
                >
                  {importing ? 'Importing…' : 'Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
