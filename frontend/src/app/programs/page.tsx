'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface Station {
  id: string;
  name: string;
}

interface Program {
  id: string;
  station_id: string;
  name: string;
  description: string | null;
  air_days: string[];
  start_time: string | null;
  end_time: string | null;
  is_active: boolean;
  dj_profile_id: string | null;
}

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
  fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface FormState {
  name: string;
  description: string;
  air_days: string[];
  start_time: string;
  end_time: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '', description: '', air_days: [], start_time: '', end_time: '', is_active: true,
};

export default function ProgramsPage() {
  const router = useRouter();
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }

    api.get<Station[]>('/api/v1/stations').then((data) => {
      setStations(data);
      if (data.length > 0) setSelectedStation(data[0].id);
    }).catch(() => setError('Failed to load stations')).finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!selectedStation) return;
    api.get<Program[]>(`/api/v1/stations/${selectedStation}/programs`)
      .then(setPrograms)
      .catch(() => setPrograms([]));
  }, [selectedStation]);

  function toggleDay(day: string) {
    setForm((f) => ({
      ...f,
      air_days: f.air_days.includes(day)
        ? f.air_days.filter((d) => d !== day)
        : [...f.air_days, day],
    }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError('');
  }

  function openEdit(p: Program) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description ?? '',
      air_days: p.air_days ?? [],
      start_time: p.start_time ?? '',
      end_time: p.end_time ?? '',
      is_active: p.is_active,
    });
    setShowForm(true);
    setError('');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      air_days: form.air_days,
      start_time: form.start_time || undefined,
      end_time: form.end_time || undefined,
      is_active: form.is_active,
    };

    try {
      if (editingId) {
        const updated = await api.put<Program>(`/api/v1/stations/${selectedStation}/programs/${editingId}`, payload);
        setPrograms((prev) => prev.map((p) => p.id === editingId ? updated : p));
      } else {
        const created = await api.post<Program>(`/api/v1/stations/${selectedStation}/programs`, payload);
        setPrograms((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete program "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/v1/stations/${selectedStation}/programs/${id}`);
      setPrograms((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setError('Failed to delete program');
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Programs</h1>
          <p className="text-gray-400 mt-1">Manage recurring shows and their episode schedules.</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium transition-colors"
        >
          + New Program
        </button>
      </div>

      {stations.length > 1 && (
        <div>
          <label className="block text-sm text-gray-300 mb-1">Station</label>
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
          >
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {error && !showForm && <p className="text-red-400 text-sm">{error}</p>}

      {/* Program form */}
      {showForm && (
        <form onSubmit={handleSave} className="bg-gray-800 rounded-lg p-6 space-y-4 border border-gray-700">
          <h2 className="text-lg font-semibold text-white">{editingId ? 'Edit Program' : 'New Program'}</h2>
          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div>
            <label className="block text-sm text-gray-300 mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Morning Rush"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-2">Air Days</label>
            <div className="flex flex-wrap gap-2">
              {ALL_DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    form.air_days.includes(day)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Start Time</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">End Time</label>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="rounded"
            />
            <label htmlFor="is_active" className="text-sm text-gray-300">Active</label>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium transition-colors"
            >
              {saving ? 'Saving…' : (editingId ? 'Save Changes' : 'Create Program')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-white px-4 py-2 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Programs list */}
      {programs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No programs yet</p>
          <p className="text-sm">Create a program to group episodes and manage your show schedule.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {programs.map((p) => (
            <div key={p.id} className="bg-gray-800 rounded-lg p-5 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-white font-semibold">{p.name}</h3>
                  {!p.is_active && (
                    <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Inactive</span>
                  )}
                </div>
                {p.description && <p className="text-gray-400 text-sm mb-2">{p.description}</p>}
                <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                  {p.air_days?.length > 0 && (
                    <span>{p.air_days.map((d) => DAY_LABELS[d] ?? d).join(', ')}</span>
                  )}
                  {p.start_time && p.end_time && (
                    <span>{p.start_time} – {p.end_time}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Link
                  href={`/programs/${p.id}/episodes?station_id=${selectedStation}`}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Episodes
                </Link>
                <button
                  onClick={() => openEdit(p)}
                  className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(p.id, p.name)}
                  className="text-sm text-gray-500 hover:text-red-400 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
