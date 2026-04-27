'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface ProgramTheme {
  id: string;
  type: string;
  priority: number;
  active: boolean;
  config: Record<string, unknown>;
}

interface Program {
  id: string;
  station_id: string;
  name: string;
  description: string | null;
  active_days: string[];
  start_hour: number;
  end_hour: number;
  color_tag: string | null;
  themes: ProgramTheme[];
  is_active: boolean;
  is_default: boolean;
}

interface ShowClockSlot {
  position: number;
  content_type: string;
  segment_type: string | null;
  target_minute: number | null;
  duration_est_sec: number | null;
  is_required: boolean;
}

interface ShowClock {
  id: string;
  name: string;
  is_default: boolean;
  slots: ShowClockSlot[];
}

interface ProgramEpisode {
  id: string;
  playlist_id: string;
  air_date: string;
  episode_title: string | null;
  published_at: string | null;
}

interface PlaylistWithEpisode {
  id: string;
  date: string;
  status: string;
  episode?: ProgramEpisode;
}

type Tab = 'overview' | 'episodes' | 'themes' | 'settings';

const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

const CONTENT_TYPE_COLORS: Record<string, string> = {
  song: '#4b5563',
  dj_segment: '#7c3aed',
  weather: '#0891b2',
  news: '#d97706',
  adlib: '#059669',
  joke: '#db2777',
  time_check: '#6b7280',
  station_id: '#7c3aed',
  ad_break: '#374151',
  listener_activity: '#2563eb',
};

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-800 text-gray-400',
  generating: 'bg-blue-900/30 text-blue-400',
  ready: 'bg-yellow-900/30 text-yellow-400',
  approved: 'bg-green-900/30 text-green-400',
  exported: 'bg-violet-900/30 text-violet-400',
  failed: 'bg-red-900/30 text-red-400',
};

export default function ProgramDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [program, setProgram] = useState<Program | null>(null);
  const [clocks, setClocks] = useState<ShowClock[]>([]);
  const [episodes, setEpisodes] = useState<ProgramEpisode[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistWithEpisode[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [month, setMonth] = useState(() => getMonthKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [episodesLoading, setEpisodesLoading] = useState(false);

  // Edit settings state
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editActive, setEditActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }
  }, [router]);

  const loadProgram = useCallback(async () => {
    setLoading(true);
    try {
      const [prog, clockData] = await Promise.all([
        api.get<unknown>(`/api/v1/programs/${id}`) as Promise<Program>,
        api.get<unknown>(`/api/v1/programs/${id}/clocks`) as Promise<ShowClock[]>,
      ]);
      setProgram(prog);
      setClocks(clockData);
      setEditName(prog.name);
      setEditDesc(prog.description ?? '');
      setEditActive(prog.is_active);
    } catch {
      router.push('/programs');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { loadProgram(); }, [loadProgram]);

  const loadEpisodes = useCallback(async () => {
    if (!program) return;
    setEpisodesLoading(true);
    try {
      // Load episodes for this program (filtered by month)
      const eps = await api.get<unknown>(`/api/v1/programs/${id}/episodes?month=${month}`) as ProgramEpisode[];
      setEpisodes(eps);
      // Also load all playlists for the station for this month to show non-episode days
      const pls = await api.get<unknown>(`/api/v1/stations/${program.station_id}/playlists?month=${month}`) as PlaylistWithEpisode[];
      // Cross-reference playlists with episodes
      const epsByPlaylist = new Map(eps.map(e => [e.playlist_id, e]));
      setPlaylists(pls.map(pl => ({ ...pl, episode: epsByPlaylist.get(pl.id) })));
    } catch {
      setEpisodes([]);
      setPlaylists([]);
    } finally {
      setEpisodesLoading(false);
    }
  }, [id, month, program]);

  useEffect(() => {
    if (tab === 'episodes') loadEpisodes();
  }, [tab, loadEpisodes]);

  async function saveSettings() {
    if (!program || saving) return;
    setSaving(true);
    try {
      const updated = await api.put<unknown>(`/api/v1/programs/${program.id}`, { name: editName, description: editDesc || null, is_active: editActive }) as Program;
      setProgram(updated);
    } finally {
      setSaving(false);
    }
  }

  async function deleteProgram() {
    if (!program || program.is_default) return;
    setDeleting(true);
    try {
      await api.delete<unknown>(`/api/v1/programs/${program.id}`);
      router.push('/programs');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
      </div>
    );
  }

  if (!program) return null;

  const color = program.color_tag ?? '#7c3aed';
  const defaultClock = clocks.find(c => c.is_default) ?? clocks[0];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <Link href="/programs" className="text-gray-500 hover:text-gray-300 mt-1 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <h1 className="text-2xl font-bold text-white truncate">{program.name}</h1>
            {program.is_default && (
              <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">default</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-gray-500 text-sm">
              {program.active_days.map(d => DAY_LABELS[d]).join(', ')} · {formatHour(program.start_hour)} – {formatHour(program.end_hour)}
            </span>
          </div>
        </div>
        <Link
          href={`/programs/${id}/clock`}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" strokeWidth={1.8}/>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6v6l4 2"/>
          </svg>
          Edit Clock
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#12121f] rounded-lg p-1 mb-6 w-fit">
        {(['overview', 'episodes', 'themes', 'settings'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t
                ? 'bg-violet-600 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Show Clock summary */}
          <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">Show Clock</h2>
              <Link
                href={`/programs/${id}/clock`}
                className="text-violet-400 hover:text-violet-300 text-xs transition-colors"
              >
                Edit →
              </Link>
            </div>
            {!defaultClock || defaultClock.slots.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-gray-600 text-sm mb-3">No clock defined yet</p>
                <Link
                  href={`/programs/${id}/clock`}
                  className="text-violet-400 hover:text-violet-300 text-sm transition-colors"
                >
                  Set up the Show Clock →
                </Link>
              </div>
            ) : (
              <div className="space-y-1.5">
                {/* Preview bar */}
                <div className="flex rounded overflow-hidden h-4 mb-3">
                  {defaultClock.slots.map((slot, i) => {
                    const total = defaultClock.slots.reduce((a, s) => a + (s.duration_est_sec ?? 60), 0) || 1;
                    const pct = ((slot.duration_est_sec ?? 60) / total) * 100;
                    return (
                      <div
                        key={i}
                        className="h-full"
                        style={{ width: `${pct}%`, backgroundColor: CONTENT_TYPE_COLORS[slot.content_type] ?? '#4b5563' }}
                        title={slot.content_type}
                      />
                    );
                  })}
                </div>
                {/* Slot list */}
                {defaultClock.slots.slice(0, 8).map((slot, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-xs">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CONTENT_TYPE_COLORS[slot.content_type] ?? '#4b5563' }}
                    />
                    {slot.target_minute !== null && (
                      <span className="text-gray-600 w-6 text-right">{slot.target_minute}&apos;</span>
                    )}
                    <span className="text-gray-400 capitalize">{slot.content_type.replace('_', ' ')}</span>
                    {slot.segment_type && (
                      <span className="text-gray-600">({slot.segment_type.replace('_', ' ')})</span>
                    )}
                  </div>
                ))}
                {defaultClock.slots.length > 8 && (
                  <p className="text-gray-600 text-xs mt-1">+{defaultClock.slots.length - 8} more slots</p>
                )}
              </div>
            )}
          </div>

          {/* Program info */}
          <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-5 space-y-4">
            <h2 className="text-white font-semibold">Program Info</h2>
            {program.description && (
              <p className="text-gray-400 text-sm">{program.description}</p>
            )}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Schedule</span>
                <span className="text-gray-300">
                  {program.active_days.map(d => DAY_LABELS[d]).join(', ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Time slot</span>
                <span className="text-gray-300">{formatHour(program.start_hour)} – {formatHour(program.end_hour)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Duration</span>
                <span className="text-gray-300">{program.end_hour - program.start_hour}h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={program.is_active ? 'text-green-400' : 'text-gray-500'}>
                  {program.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <button
              onClick={() => setTab('episodes')}
              className="w-full mt-2 bg-[#12122a] hover:bg-[#1e1e3a] text-gray-300 text-sm px-4 py-2.5 rounded-lg transition-colors"
            >
              View All Episodes →
            </button>
          </div>
        </div>
      )}

      {/* Episodes Tab */}
      {tab === 'episodes' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const [y, m] = month.split('-').map(Number);
                  const d = new Date(y, m - 2, 1);
                  setMonth(getMonthKey(d));
                }}
                className="text-gray-500 hover:text-gray-300 p-1 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
                </svg>
              </button>
              <span className="text-white font-medium w-36 text-center">{monthLabel(month)}</span>
              <button
                onClick={() => {
                  const [y, m] = month.split('-').map(Number);
                  const d = new Date(y, m, 1);
                  setMonth(getMonthKey(d));
                }}
                className="text-gray-500 hover:text-gray-300 p-1 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>

          {episodesLoading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-500" />
            </div>
          ) : episodes.length === 0 ? (
            <div className="text-center py-12 text-gray-600">
              No episodes in {monthLabel(month)}.
              <br/>
              <span className="text-sm">Generate playlists from the <Link href="/playlists" className="text-violet-400 hover:underline">Playlists</Link> page to create episodes.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {episodes
                .sort((a, b) => a.air_date.localeCompare(b.air_date))
                .map(ep => {
                  const pl = playlists.find(p => p.id === ep.playlist_id);
                  const dateLabel = new Date(ep.air_date + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                  });
                  return (
                    <div key={ep.id} className="flex items-center gap-4 bg-[#1a1a2e] border border-[#2a2a40] rounded-xl px-4 py-3 hover:border-[#3a3a55] transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white text-sm font-medium">{dateLabel}</span>
                          {ep.episode_title && (
                            <span className="text-gray-500 text-sm">· {ep.episode_title}</span>
                          )}
                        </div>
                        {pl && (
                          <span className={`inline-flex mt-0.5 text-xs px-1.5 py-0.5 rounded ${STATUS_STYLES[pl.status] ?? 'text-gray-400'}`}>
                            {pl.status}
                          </span>
                        )}
                      </div>
                      {ep.published_at && (
                        <span className="text-green-500 text-xs">Published</span>
                      )}
                      <Link
                        href={`/programs/${id}/episodes/${ep.id}`}
                        className="text-violet-400 hover:text-violet-300 text-sm transition-colors"
                      >
                        View →
                      </Link>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {/* Themes Tab */}
      {tab === 'themes' && (
        <ProgramThemesEditor
          programId={program.id}
          themes={program.themes ?? []}
          onUpdate={(themes) => setProgram({ ...program, themes })}
        />
      )}

      {tab === 'settings' && !program.is_default && (
        <div className="max-w-lg space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Program Name</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Description</label>
            <textarea
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              rows={3}
              className="w-full bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_active"
              checked={editActive}
              onChange={e => setEditActive(e.target.checked)}
              className="rounded border-gray-600"
            />
            <label htmlFor="is_active" className="text-sm text-gray-400">Active</label>
          </div>
          <div className="flex gap-3">
            <button
              onClick={saveSettings}
              disabled={saving}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
          <div className="border-t border-[#2a2a40] pt-5 mt-5">
            <h3 className="text-red-400 text-sm font-medium mb-2">Danger Zone</h3>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-sm text-red-500 hover:text-red-400 border border-red-900/40 px-4 py-2 rounded-lg transition-colors"
            >
              Delete Program
            </button>
            <p className="text-gray-600 text-xs mt-1.5">Episodes will be moved to the Unassigned default program.</p>
          </div>
        </div>
      )}
      {tab === 'settings' && program.is_default && (
        <p className="text-gray-500 text-sm">The default program cannot be edited or deleted.</p>
      )}

      {/* Delete confirmation modal (settings tab) */}
      {showDeleteConfirm && program && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-white font-semibold mb-2">Delete &ldquo;{program.name}&rdquo;?</h3>
            <p className="text-gray-400 text-sm mb-6">
              All episodes will be moved to the <span className="text-gray-300">Unassigned</span> default program. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-[#12122a] hover:bg-[#1e1e3a] border border-[#2a2a40] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deleteProgram}
                disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Program Themes Editor ──────────────────────────────────────────────────

const THEME_TYPES = [
  { value: 'weather_reactive', label: 'Weather Reactive', description: 'Auto-adapt mood to current weather' },
  { value: 'news_reactive', label: 'News Reactive', description: 'Weave trending news into DJ segments' },
  { value: 'sponsored', label: 'Sponsored', description: 'Natural brand mentions in DJ dialogue' },
  { value: 'social_driven', label: 'Social Driven', description: 'Listener comments/chat drive content' },
  { value: 'custom', label: 'Custom Theme', description: 'User-defined theme (throwback, love songs, etc.)' },
  { value: 'event', label: 'Event', description: 'Calendar-linked theme (holiday, concert, sports)' },
  { value: 'mood', label: 'Mood Override', description: 'Set explicit mood/energy for the program' },
] as const;

const MOOD_OPTIONS = ['chill', 'relax', 'balanced', 'focused', 'energize', 'motivate', 'hype', 'party'];

function ProgramThemesEditor({
  programId,
  themes,
  onUpdate,
}: {
  programId: string;
  themes: ProgramTheme[];
  onUpdate: (themes: ProgramTheme[]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState('custom');

  async function saveThemes(updated: ProgramTheme[]) {
    setSaving(true);
    setError('');
    try {
      const result = await api.put<Program>(`/api/v1/programs/${programId}`, { themes: updated });
      onUpdate(result.themes ?? updated);
    } catch (err: unknown) {
      setError((err as { message?: string }).message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function addTheme() {
    const id = `t_${Date.now()}`;
    const base: ProgramTheme = { id, type: newType, priority: 5, active: true, config: {} };

    if (newType === 'custom') {
      base.config = { theme_name: '', dj_directive: '', playlist_filter: {} };
    } else if (newType === 'sponsored') {
      base.config = { brand_name: '', brand_voice: '', tagline: '', mentions_per_hour: 2, cta: '' };
    } else if (newType === 'mood') {
      base.config = { mood: 'balanced', description: '' };
    } else if (newType === 'weather_reactive') {
      base.config = { sensitivity: 'high' };
    } else if (newType === 'news_reactive') {
      base.config = { max_mentions_per_hour: 3, categories: ['local', 'entertainment'] };
    }

    const updated = [...themes, base];
    saveThemes(updated);
    setShowAdd(false);
  }

  function removeTheme(id: string) {
    saveThemes(themes.filter(t => t.id !== id));
  }

  function toggleTheme(id: string) {
    saveThemes(themes.map(t => t.id === id ? { ...t, active: !t.active } : t));
  }

  function updateThemeConfig(id: string, config: Record<string, unknown>) {
    saveThemes(themes.map(t => t.id === id ? { ...t, config } : t));
  }

  function updatePriority(id: string, priority: number) {
    saveThemes(themes.map(t => t.id === id ? { ...t, priority } : t));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold">Program Themes</h2>
          <p className="text-xs text-gray-500 mt-0.5">Themes shape playlist selection and DJ dialogue. Stack multiple with priority weights.</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="btn-primary text-xs px-3 py-1.5"
        >
          + Add Theme
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {saving && <p className="text-xs text-violet-400">Saving...</p>}

      {/* Add theme panel */}
      {showAdd && (
        <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-4">
          <p className="text-sm text-gray-300 mb-2">Select theme type:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            {THEME_TYPES.map(tt => (
              <label key={tt.value} className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer border transition-colors ${newType === tt.value ? 'border-violet-500 bg-violet-900/20' : 'border-[#2a2a40] hover:border-gray-600'}`}>
                <input type="radio" name="theme_type" value={tt.value} checked={newType === tt.value} onChange={() => setNewType(tt.value)} className="mt-0.5" />
                <div>
                  <p className="text-sm text-white">{tt.label}</p>
                  <p className="text-xs text-gray-500">{tt.description}</p>
                </div>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={addTheme} className="btn-primary text-xs px-4 py-1.5">Add</button>
            <button onClick={() => setShowAdd(false)} className="btn-secondary text-xs px-4 py-1.5">Cancel</button>
          </div>
        </div>
      )}

      {/* Theme list */}
      {themes.length === 0 && !showAdd && (
        <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-8 text-center">
          <p className="text-gray-500 text-sm">No themes configured. Add a theme to shape this program&apos;s content.</p>
        </div>
      )}

      {themes.map(theme => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          onToggle={() => toggleTheme(theme.id)}
          onRemove={() => removeTheme(theme.id)}
          onUpdateConfig={(cfg) => updateThemeConfig(theme.id, cfg)}
          onUpdatePriority={(p) => updatePriority(theme.id, p)}
        />
      ))}
    </div>
  );
}

function ThemeCard({
  theme,
  onToggle,
  onRemove,
  onUpdateConfig,
  onUpdatePriority,
}: {
  theme: ProgramTheme;
  onToggle: () => void;
  onRemove: () => void;
  onUpdateConfig: (config: Record<string, unknown>) => void;
  onUpdatePriority: (p: number) => void;
}) {
  const typeInfo = THEME_TYPES.find(t => t.value === theme.type);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-[#1a1a2e] border rounded-xl p-4 transition-colors ${theme.active ? 'border-violet-500/50' : 'border-[#2a2a40] opacity-60'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onToggle} title={theme.active ? 'Disable' : 'Enable'} className={`w-8 h-5 rounded-full relative transition-colors ${theme.active ? 'bg-violet-600' : 'bg-gray-700'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${theme.active ? 'left-3.5' : 'left-0.5'}`} />
          </button>
          <div>
            <p className="text-sm text-white font-medium">{typeInfo?.label ?? theme.type}</p>
            <p className="text-xs text-gray-500">{getThemeSummary(theme)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">
            Priority:
            <input
              type="number" min={1} max={10}
              value={theme.priority}
              onChange={(e) => onUpdatePriority(Math.max(1, Math.min(10, Number(e.target.value))))}
              className="ml-1 w-10 bg-[#0f0f1a] border border-[#2a2a40] rounded px-1 py-0.5 text-white text-xs text-center"
            />
          </label>
          <button onClick={() => setExpanded(!expanded)} className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1">
            {expanded ? 'Collapse' : 'Edit'}
          </button>
          <button onClick={onRemove} className="text-red-500 hover:text-red-400 text-xs px-2 py-1">Remove</button>
        </div>
      </div>

      {/* Expanded config editor */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-[#2a2a40] space-y-3">
          {theme.type === 'custom' && (
            <CustomThemeConfig config={theme.config} onChange={onUpdateConfig} />
          )}
          {theme.type === 'sponsored' && (
            <SponsoredThemeConfig config={theme.config} onChange={onUpdateConfig} />
          )}
          {theme.type === 'mood' && (
            <MoodThemeConfig config={theme.config} onChange={onUpdateConfig} />
          )}
          {theme.type === 'news_reactive' && (
            <NewsThemeConfig config={theme.config} onChange={onUpdateConfig} />
          )}
          {(theme.type === 'weather_reactive' || theme.type === 'event' || theme.type === 'social_driven') && (
            <p className="text-xs text-gray-500">This theme auto-configures based on external data. No additional settings needed.</p>
          )}
        </div>
      )}
    </div>
  );
}

function getThemeSummary(theme: ProgramTheme): string {
  const cfg = theme.config;
  switch (theme.type) {
    case 'custom': return (cfg.theme_name as string) || 'Custom theme';
    case 'sponsored': return (cfg.brand_name as string) || 'Sponsor';
    case 'mood': return `Mood: ${(cfg.mood as string) || 'balanced'}`;
    case 'weather_reactive': return 'Adapts to current weather';
    case 'news_reactive': return `Max ${cfg.max_mentions_per_hour ?? 3} mentions/hour`;
    case 'social_driven': return 'Pulls from listener comments';
    case 'event': return (cfg.event_name as string) || 'Calendar event';
    default: return theme.type;
  }
}

function CustomThemeConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Theme Name</label>
        <input type="text" value={(config.theme_name as string) ?? ''} onChange={e => onChange({ ...config, theme_name: e.target.value })} placeholder="e.g. Throwback Friday" className="input w-full text-sm" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">DJ Directive</label>
        <textarea value={(config.dj_directive as string) ?? ''} onChange={e => onChange({ ...config, dj_directive: e.target.value })} placeholder="How should the DJ adapt? e.g. 'Be nostalgic, reference years/eras, say remember when...'" rows={3} className="input w-full text-sm resize-none" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Era Filter (comma-separated, e.g. 2000s,2010s)</label>
        <input type="text" value={((config.playlist_filter as Record<string, unknown>)?.era as string[] ?? []).join(', ')} onChange={e => onChange({ ...config, playlist_filter: { ...((config.playlist_filter as Record<string, unknown>) ?? {}), era: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} placeholder="2000s, 2010s" className="input w-full text-sm" />
      </div>
    </>
  );
}

function SponsoredThemeConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Brand Name</label>
          <input type="text" value={(config.brand_name as string) ?? ''} onChange={e => onChange({ ...config, brand_name: e.target.value })} placeholder="Globe Telecom" className="input w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Mentions/Hour</label>
          <input type="number" min={1} max={5} value={(config.mentions_per_hour as number) ?? 2} onChange={e => onChange({ ...config, mentions_per_hour: Number(e.target.value) })} className="input w-full text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Brand Voice</label>
        <input type="text" value={(config.brand_voice as string) ?? ''} onChange={e => onChange({ ...config, brand_voice: e.target.value })} placeholder="energetic, adventurous, bold" className="input w-full text-sm" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Tagline</label>
        <input type="text" value={(config.tagline as string) ?? ''} onChange={e => onChange({ ...config, tagline: e.target.value })} placeholder="Brand gives you wings" className="input w-full text-sm" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Call to Action</label>
        <input type="text" value={(config.cta as string) ?? ''} onChange={e => onChange({ ...config, cta: e.target.value })} placeholder="Visit brand.com" className="input w-full text-sm" />
      </div>
    </>
  );
}

function MoodThemeConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Mood</label>
        <select value={(config.mood as string) ?? 'balanced'} onChange={e => onChange({ ...config, mood: e.target.value })} className="input w-full text-sm">
          {MOOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Description (optional)</label>
        <input type="text" value={(config.description as string) ?? ''} onChange={e => onChange({ ...config, description: e.target.value })} placeholder="Additional mood guidance for DJ" className="input w-full text-sm" />
      </div>
    </>
  );
}

function NewsThemeConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Max Mentions/Hour</label>
        <input type="number" min={1} max={5} value={(config.max_mentions_per_hour as number) ?? 3} onChange={e => onChange({ ...config, max_mentions_per_hour: Number(e.target.value) })} className="input w-full text-sm" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Categories (comma-separated)</label>
        <input type="text" value={((config.categories as string[]) ?? []).join(', ')} onChange={e => onChange({ ...config, categories: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="local, entertainment, sports" className="input w-full text-sm" />
      </div>
    </>
  );
}
