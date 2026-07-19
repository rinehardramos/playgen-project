'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface Station {
  id: string;
  name: string;
}

interface Host {
  name: string;
  provider: string;
  voice_id: string;
  api_key?: string;
}

interface Episode {
  id: string;
  station_id: string;
  title: string;
  source: 'imported' | 'generated';
  topic: string | null;
  script_text: string;
  hosts: Host[];
  status: 'pending' | 'generating_script' | 'rendering' | 'ready' | 'failed';
  error_message: string | null;
  audio_url: string | null;
  audio_duration_sec: number | null;
  created_at: string;
}

const PROVIDERS = [
  { value: 'mistral', label: 'Mistral (Voxtral)' },
  { value: 'elevenlabs', label: 'ElevenLabs (incl. cloned voices)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'narakeet', label: 'Narakeet' },
];

const STATUS_STYLES: Record<Episode['status'], string> = {
  pending: 'bg-gray-700 text-gray-300',
  generating_script: 'bg-purple-900 text-purple-300',
  rendering: 'bg-blue-900 text-blue-300',
  ready: 'bg-green-900 text-green-300',
  failed: 'bg-red-900 text-red-300',
};

const ACTIVE_STATUSES = ['pending', 'generating_script', 'rendering'];

function emptyHost(name: string, provider: string, voice_id: string): Host {
  return { name, provider, voice_id, api_key: '' };
}

export default function PodcastPage() {
  const router = useRouter();
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'import' | 'generate'>('import');
  const [scriptText, setScriptText] = useState('');
  const [topic, setTopic] = useState('');
  const [hosts, setHosts] = useState<[Host, Host]>([
    emptyHost('Alex', 'mistral', 'en_paul_cheerful'),
    emptyHost('Sam', 'elevenlabs', ''),
  ]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }
    api.stations.list(user.company_id).then((data) => {
      setStations(data);
      if (data.length > 0) setSelectedStation(data[0].id);
    }).catch(() => setError('Failed to load stations')).finally(() => setLoading(false));
  }, [router]);

  const refreshEpisodes = useCallback(async () => {
    if (!selectedStation) return;
    try {
      const data = await api.get<Episode[]>(`/api/v1/dj/podcasts?station_id=${selectedStation}`);
      setEpisodes(data);
    } catch { /* non-fatal */ }
  }, [selectedStation]);

  useEffect(() => { refreshEpisodes(); }, [refreshEpisodes]);

  // Poll while any episode is still working its way through the pipeline
  useEffect(() => {
    if (!episodes.some((e) => ACTIVE_STATUSES.includes(e.status))) return;
    const t = setInterval(refreshEpisodes, 3000);
    return () => clearInterval(t);
  }, [episodes, refreshEpisodes]);

  function updateHost(index: 0 | 1, patch: Partial<Host>) {
    setHosts((prev) => {
      const next: [Host, Host] = [{ ...prev[0] }, { ...prev[1] }];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setScriptText(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!title.trim()) { setError('Title is required'); return; }
    if (mode === 'import' && !scriptText.trim()) { setError('Paste or import a script'); return; }
    if (mode === 'generate' && !topic.trim()) { setError('Enter a topic to generate a script'); return; }
    if (hosts.some((h) => !h.name.trim() || !h.voice_id.trim())) {
      setError('Both hosts need a name and a voice ID');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/v1/dj/podcasts', {
        station_id: selectedStation,
        title: title.trim(),
        script_text: mode === 'import' ? scriptText : undefined,
        topic: mode === 'generate' ? topic.trim() : undefined,
        hosts: hosts.map((h) => ({
          name: h.name.trim(),
          provider: h.provider,
          voice_id: h.voice_id.trim(),
          ...(h.api_key?.trim() ? { api_key: h.api_key.trim() } : {}),
        })),
      });
      setSuccess('Episode queued — rendering starts now. Audio appears below when ready.');
      setTitle('');
      setScriptText('');
      setTopic('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refreshEpisodes();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create episode');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRerender(id: string) {
    try {
      await api.post(`/api/v1/dj/podcasts/${id}/render`, {});
      await refreshEpisodes();
    } catch {
      setError('Failed to re-render episode');
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/v1/dj/podcasts/${id}`);
      setEpisodes((prev) => prev.filter((ep) => ep.id !== id));
    } catch {
      setError('Failed to delete episode');
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Podcast Studio</h1>
        <p className="text-gray-400 mt-1">
          Import your own script — or generate one from a topic — and render it as a
          two-host show. Each host plugs in their own voice AI (Mistral Voxtral or an
          ElevenLabs voice, including your cloned voices).
        </p>
      </div>

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

      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg p-6 space-y-5">
        <h2 className="text-lg font-semibold text-white">New Episode</h2>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {success && <p className="text-green-400 text-sm">{success}</p>}

        <div>
          <label className="block text-sm text-gray-300 mb-1">Episode Title <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Morning Brew #12 — OPM Throwbacks"
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500"
          />
        </div>

        {/* Script source */}
        <div className="flex gap-2">
          {(['import', 'generate'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                mode === m ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {m === 'import' ? 'Import my script' : 'Generate from topic'}
            </button>
          ))}
        </div>

        {mode === 'import' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm text-gray-300">
                Script <span className="text-red-400">*</span>{' '}
                <span className="text-gray-500">
                  — tag lines with [HostName], or paste plain text to alternate hosts automatically
                </span>
              </label>
              <label className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">
                Import .txt file
                <input ref={fileInputRef} type="file" accept=".txt,.md,text/plain" onChange={handleFileImport} className="hidden" />
              </label>
            </div>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              rows={8}
              placeholder={`[Alex] Welcome back to the show!\n[Sam] Great to be here — today we're talking about…`}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 font-mono text-sm"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm text-gray-300 mb-1">Topic <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. The history of 90s Philippine OPM rock"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500"
            />
          </div>
        )}

        {/* Hosts */}
        <div className="grid md:grid-cols-2 gap-4">
          {([0, 1] as const).map((i) => (
            <div key={i} className="bg-gray-900 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Host {i + 1}</h3>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={hosts[i].name}
                  onChange={(e) => updateHost(i, { name: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Voice AI</label>
                <select
                  value={hosts[i].provider}
                  onChange={(e) => updateHost(i, { provider: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Voice ID{' '}
                  <span className="text-gray-500">
                    {hosts[i].provider === 'elevenlabs'
                      ? '(your ElevenLabs voice — cloned voices work here)'
                      : hosts[i].provider === 'mistral'
                        ? '(e.g. en_paul_cheerful, gb_jane_sarcasm)'
                        : ''}
                  </span>
                </label>
                <input
                  type="text"
                  value={hosts[i].voice_id}
                  onChange={(e) => updateHost(i, { voice_id: e.target.value })}
                  placeholder={hosts[i].provider === 'elevenlabs' ? 'ElevenLabs voice_id' : 'voice id'}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm placeholder-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  API Key <span className="text-gray-500">(optional — bring your own account, never stored)</span>
                </label>
                <input
                  type="password"
                  value={hosts[i].api_key ?? ''}
                  onChange={(e) => updateHost(i, { api_key: e.target.value })}
                  placeholder="Uses the station key if empty"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm placeholder-gray-500"
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={submitting || !selectedStation}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium transition-colors"
        >
          {submitting ? 'Queuing…' : 'Create Episode'}
        </button>
      </form>

      {/* Episode list */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">
          Episodes <span className="text-gray-400 text-sm font-normal">({episodes.length})</span>
        </h2>
        {episodes.length === 0 ? (
          <p className="text-gray-500 text-sm">No episodes yet. Create one above!</p>
        ) : (
          <ul className="space-y-3">
            {episodes.map((ep) => (
              <li key={ep.id} className="bg-gray-800 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-white font-medium">{ep.title}</span>
                    <span className="text-gray-500 text-xs ml-2">
                      {ep.hosts.map((h) => h.name).join(' & ')} · {ep.source === 'imported' ? 'imported script' : 'AI-generated script'}
                      {ep.audio_duration_sec ? ` · ${Math.round(ep.audio_duration_sec / 60)}m ${Math.round(ep.audio_duration_sec % 60)}s` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded capitalize ${STATUS_STYLES[ep.status]}`}>
                      {ep.status.replace('_', ' ')}
                    </span>
                    {(ep.status === 'failed' || ep.status === 'ready') && (
                      <button onClick={() => handleRerender(ep.id)} className="text-xs text-blue-400 hover:text-blue-300">
                        Re-render
                      </button>
                    )}
                    <button onClick={() => handleDelete(ep.id)} className="text-xs text-gray-500 hover:text-red-400">
                      Delete
                    </button>
                  </div>
                </div>
                {ep.status === 'failed' && ep.error_message && (
                  <p className="text-red-400 text-xs">{ep.error_message}</p>
                )}
                {ep.status === 'ready' && ep.audio_url && (
                  <audio controls preload="none" src={ep.audio_url} className="w-full h-9" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
