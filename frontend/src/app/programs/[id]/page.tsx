'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface Program {
  id: string;
  station_id: string;
  name: string;
  description: string | null;
  active_days: string[];
  start_hour: number;
  end_hour: number;
  color_tag: string | null;
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

type Tab = 'overview' | 'episodes' | 'settings';

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

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }
  }, [router]);

  const loadProgram = useCallback(async () => {
    setLoading(true);
    try {
      const [prog, clockData] = await Promise.all([
        api(`/api/v1/programs/${id}`) as Promise<Program>,
        api(`/api/v1/programs/${id}/clocks`) as Promise<ShowClock[]>,
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
      const eps = await api(`/api/v1/programs/${id}/episodes?month=${month}`) as ProgramEpisode[];
      setEpisodes(eps);
      // Also load all playlists for the station for this month to show non-episode days
      const pls = await api(`/api/v1/stations/${program.station_id}/playlists?month=${month}`) as PlaylistWithEpisode[];
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
      const updated = await api(`/api/v1/programs/${program.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName, description: editDesc || null, is_active: editActive }),
      }) as Program;
      setProgram(updated);
    } finally {
      setSaving(false);
    }
  }

  async function deleteProgram() {
    if (!program || program.is_default) return;
    if (!window.confirm(`Delete "${program.name}"? All episodes will be moved to Unassigned.`)) return;
    await api(`/api/v1/programs/${program.id}`, { method: 'DELETE' });
    router.push('/programs');
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
        {(['overview', 'episodes', 'settings'] as Tab[]).map(t => (
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
              onClick={deleteProgram}
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
    </div>
  );
}
