'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

type ClockContentType =
  | 'song' | 'dj_segment' | 'weather' | 'news'
  | 'adlib' | 'joke' | 'time_check' | 'station_id'
  | 'ad_break' | 'listener_activity';

const CONTENT_TYPE_LABELS: Record<ClockContentType, string> = {
  song: 'Song',
  dj_segment: 'DJ Segment',
  weather: 'Weather',
  news: 'Current Events',
  adlib: 'Adlib',
  joke: 'Joke',
  time_check: 'Time Check',
  station_id: 'Station ID',
  ad_break: 'Ad Break',
  listener_activity: 'Listener Activity',
};

const CONTENT_TYPE_COLORS: Record<ClockContentType, string> = {
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

const DJ_SEGMENT_TYPES = [
  'show_intro', 'song_intro', 'song_transition', 'show_outro',
  'station_id', 'time_check', 'weather_tease', 'ad_break',
];

interface Category {
  id: string;
  code: string;
  label: string;
  color_tag: string | null;
}

interface SlotRow {
  position: number;
  content_type: ClockContentType;
  category_id: string;
  segment_type: string;
  target_minute: string;
  duration_est_sec: string;
  is_required: boolean;
  notes: string;
}

interface ShowClock {
  id: string;
  program_id: string;
  name: string;
  applies_to_hours: number[] | null;
  is_default: boolean;
  slots: SlotRow[];
}

interface Program {
  id: string;
  name: string;
  station_id: string;
  color_tag: string | null;
}

function emptySlot(position: number): SlotRow {
  return {
    position,
    content_type: 'song',
    category_id: '',
    segment_type: '',
    target_minute: '',
    duration_est_sec: '',
    is_required: true,
    notes: '',
  };
}

function PreviewBar({ slots }: { slots: SlotRow[] }) {
  const total = slots.reduce((a, s) => a + (Number(s.duration_est_sec) || 60), 0) || 1;
  return (
    <div className="flex rounded overflow-hidden h-5 bg-[#0d0d1a]">
      {slots.map((slot, i) => {
        const pct = ((Number(slot.duration_est_sec) || 60) / total) * 100;
        return (
          <div
            key={i}
            className="h-full border-r border-[#0d0d1a] last:border-0 transition-all"
            style={{ width: `${pct}%`, backgroundColor: CONTENT_TYPE_COLORS[slot.content_type] ?? '#4b5563' }}
            title={`${CONTENT_TYPE_LABELS[slot.content_type]} (${slot.duration_est_sec || 60}s)`}
          />
        );
      })}
    </div>
  );
}

function ClockLegend({ slots }: { slots: SlotRow[] }) {
  const seen = new Set<string>();
  const unique = slots.filter(s => {
    if (seen.has(s.content_type)) return false;
    seen.add(s.content_type);
    return true;
  });
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {unique.map(s => (
        <div key={s.content_type} className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CONTENT_TYPE_COLORS[s.content_type] }} />
          <span className="text-gray-400">{CONTENT_TYPE_LABELS[s.content_type]}</span>
        </div>
      ))}
    </div>
  );
}

export default function ShowClockEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [program, setProgram] = useState<Program | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [clocks, setClocks] = useState<ShowClock[]>([]);
  const [activeClock, setActiveClock] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newClockName, setNewClockName] = useState('');
  const [addingClock, setAddingClock] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }
  }, [router]);

  const load = useCallback(async () => {
    try {
      const [prog, clockData] = await Promise.all([
        api.get<unknown>(`/api/v1/programs/${id}`) as Promise<Program>,
        api.get<unknown>(`/api/v1/programs/${id}/clocks`) as Promise<ShowClock[]>,
      ]);
      setProgram(prog);
      // Normalise slots for the form
      setClocks(clockData.map(c => ({
        ...c,
        slots: (c.slots ?? []).map((s, idx) => ({
          position: idx + 1,
          content_type: (s as unknown as { content_type: ClockContentType }).content_type,
          category_id: (s as unknown as { category_id?: string }).category_id ?? '',
          segment_type: (s as unknown as { segment_type?: string }).segment_type ?? '',
          target_minute: String((s as unknown as { target_minute?: number }).target_minute ?? ''),
          duration_est_sec: String((s as unknown as { duration_est_sec?: number }).duration_est_sec ?? ''),
          is_required: (s as unknown as { is_required?: boolean }).is_required ?? true,
          notes: (s as unknown as { notes?: string }).notes ?? '',
        })),
      })));
      // Load categories for this station
      const cats = await api.get<unknown>(`/api/v1/stations/${prog.station_id}/categories`) as Category[];
      setCategories(cats);
    } catch {
      router.push(`/programs/${id}`);
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  const current = clocks[activeClock];

  function updateSlot(slotIdx: number, field: keyof SlotRow, value: unknown) {
    setClocks(prev => {
      const next = [...prev];
      const slots = [...(next[activeClock]?.slots ?? [])];
      slots[slotIdx] = { ...slots[slotIdx], [field]: value };
      next[activeClock] = { ...next[activeClock], slots };
      return next;
    });
  }

  function addSlot() {
    setClocks(prev => {
      const next = [...prev];
      const slots = [...(next[activeClock]?.slots ?? [])];
      slots.push(emptySlot(slots.length + 1));
      next[activeClock] = { ...next[activeClock], slots };
      return next;
    });
  }

  function removeSlot(idx: number) {
    setClocks(prev => {
      const next = [...prev];
      const slots = next[activeClock]?.slots.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i + 1 })) ?? [];
      next[activeClock] = { ...next[activeClock], slots };
      return next;
    });
  }

  async function saveClock() {
    if (!current) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: current.name,
        applies_to_hours: current.applies_to_hours,
        is_default: current.is_default,
        slots: current.slots.map((s, i) => ({
          position: i + 1,
          content_type: s.content_type,
          category_id: s.category_id || null,
          segment_type: s.segment_type || null,
          target_minute: s.target_minute !== '' ? Number(s.target_minute) : null,
          duration_est_sec: s.duration_est_sec !== '' ? Number(s.duration_est_sec) : null,
          is_required: s.is_required,
          notes: s.notes || null,
        })),
      };
      if (current.id) {
        await api.put<unknown>(`/api/v1/programs/${id}/clocks/${current.id}`, payload);
      } else {
        const created = await api.post<unknown>(`/api/v1/programs/${id}/clocks`, payload) as ShowClock;
        setClocks(prev => {
          const next = [...prev];
          next[activeClock] = { ...next[activeClock], id: created.id };
          return next;
        });
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e?.message ?? 'Failed to save clock');
    } finally {
      setSaving(false);
    }
  }

  async function addClock() {
    if (!newClockName.trim()) return;
    setAddingClock(true);
    try {
      const created = await api.post<unknown>(`/api/v1/programs/${id}/clocks`, { name: newClockName.trim(), is_default: false, slots: [] }) as ShowClock;
      setClocks(prev => [...prev, { ...created, slots: [] }]);
      setActiveClock(clocks.length);
      setNewClockName('');
    } finally {
      setAddingClock(false);
    }
  }

  if (!program || !current) {
    if (!program) {
      return (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
        </div>
      );
    }
    // No clocks yet — auto-create first
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/programs/${id}`} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-white">{program.name} — Show Clock</h1>
        </div>
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-violet-600/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={1.5}/>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6l4 2"/>
            </svg>
          </div>
          <h3 className="text-white font-semibold mb-2">No Show Clock yet</h3>
          <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
            A Show Clock defines the order and type of content in each hour of this program (songs, DJ talk, weather, jokes, etc).
          </p>
          <button
            onClick={async () => {
              const created = await api.post<unknown>(`/api/v1/programs/${id}/clocks`, { name: 'Standard Hour', is_default: true, slots: [] }) as ShowClock;
              setClocks([{ ...created, slots: [] }]);
              setActiveClock(0);
            }}
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            Create Standard Hour Clock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/programs/${id}`} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">{program.name}</h1>
              <span className="text-gray-600">·</span>
              <span className="text-gray-400 text-sm">Show Clock</span>
            </div>
            <p className="text-gray-600 text-xs mt-0.5">Define the 60-minute content format for each hour of this program</p>
          </div>
        </div>
        <button
          onClick={saveClock}
          disabled={saving}
          className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save Clock'}
        </button>
      </div>

      {/* Clock tabs */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {clocks.map((c, i) => (
          <button
            key={i}
            onClick={() => setActiveClock(i)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeClock === i
                ? 'bg-violet-600 text-white'
                : 'bg-[#1a1a2e] text-gray-500 hover:text-gray-300 border border-[#2a2a40]'
            }`}
          >
            {c.name}
            {c.is_default && <span className="ml-1.5 text-xs opacity-60">default</span>}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-2">
          <input
            type="text"
            value={newClockName}
            onChange={e => setNewClockName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addClock(); }}
            placeholder="+ Add clock"
            className="bg-[#1a1a2e] border border-[#2a2a40] text-gray-400 placeholder-gray-700 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500 w-32"
          />
          {newClockName && (
            <button
              onClick={addClock}
              disabled={addingClock}
              className="bg-[#1a1a2e] border border-violet-500/40 text-violet-400 text-sm px-2 py-1.5 rounded-lg"
            >
              Add
            </button>
          )}
        </div>
      </div>

      {/* Clock metadata */}
      {!current.is_default && (
        <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-4 mb-4">
          <label className="block text-xs text-gray-500 mb-1">Applies to hours (leave blank = all hours)</label>
          <input
            type="text"
            value={current.applies_to_hours?.join(', ') ?? ''}
            onChange={e => {
              const val = e.target.value.trim();
              const hours = val ? val.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : null;
              setClocks(prev => {
                const next = [...prev];
                next[activeClock] = { ...next[activeClock], applies_to_hours: hours };
                return next;
              });
            }}
            placeholder="e.g. 6, 7, 8 (or blank for all hours)"
            className="bg-[#12121f] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500 w-72"
          />
        </div>
      )}

      {/* Preview bar */}
      {current.slots.length > 0 && (
        <div className="mb-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 uppercase tracking-wider">60-Minute Preview</span>
            <span className="text-xs text-gray-600">{current.slots.length} slots</span>
          </div>
          <PreviewBar slots={current.slots} />
          <ClockLegend slots={current.slots} />
        </div>
      )}

      {/* Slots table */}
      <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl overflow-hidden">
        <div className="grid grid-cols-[2rem_1fr_1.2fr_3rem_3.5rem_2.5rem_1fr_2rem] gap-px bg-[#2a2a40] text-xs text-gray-500 uppercase tracking-wider font-medium px-4 py-2.5 border-b border-[#2a2a40]">
          <span>#</span>
          <span>Content</span>
          <span>Category / Type</span>
          <span>Min</span>
          <span>Sec</span>
          <span>Req</span>
          <span>Notes</span>
          <span></span>
        </div>

        {current.slots.length === 0 && (
          <div className="text-center py-10 text-gray-600 text-sm">
            No slots yet. Add the first content block below.
          </div>
        )}

        {current.slots.map((slot, i) => (
          <div
            key={i}
            className="grid grid-cols-[2rem_1fr_1.2fr_3rem_3.5rem_2.5rem_1fr_2rem] gap-px bg-[#2a2a40] items-center"
          >
            <div className="bg-[#1a1a2e] px-3 py-2.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: CONTENT_TYPE_COLORS[slot.content_type] ?? '#4b5563' }}
              />
            </div>

            {/* Content type */}
            <div className="bg-[#1a1a2e] px-2 py-1.5">
              <select
                value={slot.content_type}
                onChange={e => updateSlot(i, 'content_type', e.target.value as ClockContentType)}
                className="w-full bg-transparent text-gray-300 text-xs focus:outline-none"
              >
                {Object.entries(CONTENT_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            {/* Category or segment type */}
            <div className="bg-[#1a1a2e] px-2 py-1.5">
              {slot.content_type === 'song' ? (
                <select
                  value={slot.category_id}
                  onChange={e => updateSlot(i, 'category_id', e.target.value)}
                  className="w-full bg-transparent text-gray-300 text-xs focus:outline-none"
                >
                  <option value="">Any category</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              ) : slot.content_type === 'dj_segment' ? (
                <select
                  value={slot.segment_type}
                  onChange={e => updateSlot(i, 'segment_type', e.target.value)}
                  className="w-full bg-transparent text-gray-300 text-xs focus:outline-none"
                >
                  <option value="">Any type</option>
                  {DJ_SEGMENT_TYPES.map(t => (
                    <option key={t} value={t}>{t.replace('_', ' ')}</option>
                  ))}
                </select>
              ) : (
                <span className="text-gray-600 text-xs">—</span>
              )}
            </div>

            {/* Target minute (clamped 0-59) */}
            <div className="bg-[#1a1a2e] px-2 py-1.5">
              <input
                type="number"
                min={0}
                max={59}
                value={slot.target_minute}
                onChange={e => {
                  const raw = e.target.value;
                  if (raw === '') { updateSlot(i, 'target_minute', ''); return; }
                  const n = Number(raw);
                  if (Number.isNaN(n)) return;
                  updateSlot(i, 'target_minute', String(Math.max(0, Math.min(59, Math.trunc(n)))));
                }}
                placeholder="—"
                className="w-full bg-transparent text-gray-300 text-xs focus:outline-none placeholder-gray-700"
              />
            </div>

            {/* Duration estimate */}
            <div className="bg-[#1a1a2e] px-2 py-1.5">
              <input
                type="number"
                min={1}
                value={slot.duration_est_sec}
                onChange={e => updateSlot(i, 'duration_est_sec', e.target.value)}
                placeholder="60"
                className="w-full bg-transparent text-gray-300 text-xs focus:outline-none placeholder-gray-700"
              />
            </div>

            {/* Required */}
            <div className="bg-[#1a1a2e] px-2 py-1.5 flex justify-center">
              <input
                type="checkbox"
                checked={slot.is_required}
                onChange={e => updateSlot(i, 'is_required', e.target.checked)}
                className="rounded border-gray-600"
              />
            </div>

            {/* Notes */}
            <div className="bg-[#1a1a2e] px-2 py-1.5">
              <input
                type="text"
                value={slot.notes}
                onChange={e => updateSlot(i, 'notes', e.target.value)}
                placeholder="Producer notes…"
                className="w-full bg-transparent text-gray-400 text-xs focus:outline-none placeholder-gray-700"
              />
            </div>

            {/* Delete */}
            <div className="bg-[#1a1a2e] px-2 py-1.5 flex justify-center">
              <button
                onClick={() => removeSlot(i)}
                className="text-gray-700 hover:text-red-500 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
        ))}

        {/* Add slot row */}
        <div className="px-4 py-3 border-t border-[#2a2a40]">
          <button
            onClick={addSlot}
            className="flex items-center gap-2 text-violet-400 hover:text-violet-300 text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
            </svg>
            Add slot
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

      <div className="mt-4 text-xs text-gray-600">
        <strong className="text-gray-500">Min</strong> = target minute within the hour (guidance only) ·{' '}
        <strong className="text-gray-500">Sec</strong> = estimated duration in seconds · Slot order determines broadcast sequence
      </div>
    </div>
  );
}
