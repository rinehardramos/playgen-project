'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface Station {
  id: string;
  name: string;
}

interface AdlibClip {
  id: string;
  station_id: string;
  name: string;
  audio_url: string;
  tags: string[];
  audio_duration_sec: number | null;
  file_size_bytes: number | null;
  original_filename: string | null;
  created_at: string;
}

const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-wav'];

function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdlibLibraryPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [clips, setClips] = useState<AdlibClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadTags, setUploadTags] = useState('');

  // Tag editor state
  const [editingClip, setEditingClip] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }

    api.stations.list(user.company_id)
      .then((data) => {
        setStations(data);
        if (data.length > 0) setSelectedStation(data[0].id);
      })
      .catch(() => setError('Failed to load stations'))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!selectedStation) return;
    api.get<AdlibClip[]>(`/api/v1/dj/adlib-clips?station_id=${selectedStation}`)
      .then(setClips)
      .catch(() => {/* non-fatal */});
  }, [selectedStation]);

  async function refreshClips() {
    if (!selectedStation) return;
    try {
      const data = await api.get<AdlibClip[]>(`/api/v1/dj/adlib-clips?station_id=${selectedStation}`);
      setClips(data);
    } catch {/* non-fatal */}
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Unsupported format. Use MP3, WAV, or OGG.');
      return;
    }
    setUploadFile(file);
    if (!uploadName) {
      setUploadName(file.name.replace(/\.[^.]+$/, ''));
    }
    setError('');
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile || !uploadName.trim() || !selectedStation) {
      setError('File, name, and station are required');
      return;
    }
    setUploading(true);
    setError('');
    setSuccess('');

    try {
      // Read duration client-side via HTML5 Audio API before uploading
      let audioDurationSec: number | null = null;
      try {
        audioDurationSec = await readAudioDuration(uploadFile);
      } catch {/* non-critical */}

      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('name', uploadName.trim());
      formData.append('station_id', selectedStation);
      const tags = uploadTags.split(',').map((t) => t.trim()).filter(Boolean);
      formData.append('tags', JSON.stringify(tags));
      if (audioDurationSec != null) {
        formData.append('audio_duration_sec', String(audioDurationSec));
      }

      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const res = await fetch('/api/v1/dj/adlib-clips', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Upload failed: ${res.status}`);
      }

      setSuccess('Clip uploaded successfully!');
      setUploadFile(null);
      setUploadName('');
      setUploadTags('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refreshClips();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/v1/dj/adlib-clips/${id}`);
      setClips((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setError('Failed to delete clip');
    }
  }

  function openEdit(clip: AdlibClip) {
    setEditingClip(clip.id);
    setEditName(clip.name);
    setEditTags(clip.tags.join(', '));
  }

  async function handleSaveEdit(id: string) {
    setSavingEdit(true);
    try {
      const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
      await api.patch(`/api/v1/dj/adlib-clips/${id}`, { name: editName.trim(), tags });
      setEditingClip(null);
      await refreshClips();
    } catch {
      setError('Failed to update clip');
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Adlib Library</h1>
        <p className="text-gray-400 mt-1">
          Upload pre-recorded adlib clips for your AI DJ to drop between songs.
          When clips are present, they will be used instead of AI-generated adlibs.
        </p>
      </div>

      {/* Station selector */}
      {stations.length > 1 && (
        <div>
          <label className="block text-sm text-gray-300 mb-1">Station</label>
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Upload form */}
      <form onSubmit={handleUpload} className="bg-gray-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Upload Clip</h2>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {success && <p className="text-green-400 text-sm">{success}</p>}

        <div>
          <label className="block text-sm text-gray-300 mb-1">
            Audio File <span className="text-red-400">*</span>
            <span className="text-gray-500 ml-1">(MP3, WAV, OGG — max 50 MB)</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg"
            onChange={handleFileChange}
            className="block text-sm text-gray-400 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-violet-700 file:text-white hover:file:bg-violet-600 cursor-pointer"
          />
          {uploadFile && (
            <p className="text-xs text-gray-500 mt-1">{uploadFile.name} ({formatBytes(uploadFile.size)})</p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">
            Clip Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="e.g. Stay locked in!"
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">
            Tags <span className="text-gray-500">(optional, comma-separated)</span>
          </label>
          <input
            type="text"
            value={uploadTags}
            onChange={(e) => setUploadTags(e.target.value)}
            placeholder="e.g. morning, hype, sign-off"
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500"
          />
        </div>

        <button
          type="submit"
          disabled={uploading || !uploadFile || !uploadName.trim() || !selectedStation}
          className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium transition-colors"
        >
          {uploading ? 'Uploading…' : 'Upload Clip'}
        </button>
      </form>

      {/* Clip list */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">
          Clips <span className="text-gray-400 text-sm font-normal">({clips.length})</span>
        </h2>

        {clips.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No clips uploaded yet. Upload one above to enable pre-recorded adlibs for this station.
          </p>
        ) : (
          <ul className="space-y-3">
            {clips.map((clip) => (
              <li key={clip.id} className="bg-gray-800 rounded-lg p-4 space-y-2">
                {editingClip === clip.id ? (
                  <div className="space-y-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white"
                    />
                    <input
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="Tags (comma-separated)"
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(clip.id)}
                        disabled={savingEdit}
                        className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1 rounded transition-colors disabled:opacity-50"
                      >
                        {savingEdit ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingClip(null)}
                        className="text-xs text-gray-400 hover:text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium text-sm truncate">{clip.name}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {clip.tags.length > 0 && clip.tags.map((tag, i) => (
                          <span key={i} className="text-xs bg-violet-900/30 text-violet-300 px-2 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                        <span className="text-xs text-gray-500">{formatDuration(clip.audio_duration_sec)}</span>
                        <span className="text-xs text-gray-500">{formatBytes(clip.file_size_bytes)}</span>
                        {clip.original_filename && (
                          <span className="text-xs text-gray-600 truncate max-w-[12rem]">{clip.original_filename}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-3 shrink-0">
                      <button
                        onClick={() => openEdit(clip)}
                        className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(clip.id)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Read audio duration from a File using the HTML5 Audio API. */
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.addEventListener('loadedmetadata', () => {
      URL.revokeObjectURL(url);
      if (isFinite(audio.duration) && audio.duration > 0) {
        resolve(audio.duration);
      } else {
        reject(new Error('Could not read duration'));
      }
    });
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('Audio load error'));
    });
  });
}
