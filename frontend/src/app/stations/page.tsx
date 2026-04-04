'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface Station {
  id: string;
  company_id: string;
  name: string;
  timezone: string;
  broadcast_start_hour: number;
  broadcast_end_hour: number;
  active_days: string[];
  is_active: boolean;
  dj_enabled: boolean;
  dj_auto_approve: boolean;
}

interface StationFormData {
  name: string;
  timezone: string;
  broadcast_start_hour: number;
  broadcast_end_hour: number;
  active_days: string[];
  dj_enabled: boolean;
  dj_auto_approve: boolean;
}

const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const EMPTY_FORM: StationFormData = {
  name: '',
  timezone: 'Asia/Manila',
  broadcast_start_hour: 6,
  broadcast_end_hour: 22,
  active_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  dj_enabled: false,
  dj_auto_approve: false,
};

export default function StationsPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const companyId = currentUser?.company_id ?? '';

  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const [form, setForm] = useState<StationFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchStations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function fetchStations() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Station[]>(`/api/v1/companies/${companyId}/stations`);
      setStations(data);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load stations');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingStation(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(station: Station) {
    setEditingStation(station);
    setForm({
      name: station.name,
      timezone: station.timezone,
      broadcast_start_hour: station.broadcast_start_hour,
      broadcast_end_hour: station.broadcast_end_hour,
      active_days: station.active_days,
      dj_enabled: station.dj_enabled ?? false,
      dj_auto_approve: station.dj_auto_approve ?? false,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function toggleDay(day: string) {
    setForm((prev) => ({
      ...prev,
      active_days: prev.active_days.includes(day)
        ? prev.active_days.filter((d) => d !== day)
        : [...prev.active_days, day],
    }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (editingStation) {
        await api.put<Station>(`/api/v1/stations/${editingStation.id}`, form);
      } else {
        await api.post<Station>(`/api/v1/companies/${companyId}/stations`, form);
      }
      setModalOpen(false);
      await fetchStations();
    } catch (err: unknown) {
      setFormError((err as ApiError).message ?? 'Failed to save station');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(station: Station) {
    try {
      await api.put<Station>(`/api/v1/stations/${station.id}`, { is_active: !station.is_active });
      setStations((prev) =>
        prev.map((s) => (s.id === station.id ? { ...s, is_active: !s.is_active } : s))
      );
    } catch (err: unknown) {
      alert((err as ApiError).message ?? 'Failed to update station');
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Stations</h1>
        <button onClick={openCreate} className="btn-primary">
          + Add Station
        </button>
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
                {['Name', 'Timezone', 'Broadcast Hours', 'Active Days', 'DJ', 'Status', 'Actions'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a40]">
              {stations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-600">
                    No stations found. Add your first station to get started.
                  </td>
                </tr>
              ) : (
                stations.map((station) => (
                  <tr key={station.id} className="hover:bg-[#24243a] border-b border-[#2a2a40]">
                    <td className="px-4 py-3 font-medium text-white">{station.name}</td>
                    <td className="px-4 py-3 text-gray-400">{station.timezone}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {station.broadcast_start_hour}:00 – {station.broadcast_end_hour}:00
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {station.active_days.join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {station.dj_enabled ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-900/30 text-violet-400">
                          AI DJ{station.dj_auto_approve ? ' (Auto)' : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">Off</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          station.is_active
                            ? 'bg-green-900/30 text-green-400'
                            : 'bg-gray-800 text-gray-500'
                        }`}
                      >
                        {station.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 flex items-center gap-3">
                      <button
                        onClick={() => openEdit(station)}
                        className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeactivate(station)}
                        className="text-xs text-gray-400 hover:text-gray-300 font-medium"
                      >
                        {station.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">
              {editingStation ? 'Edit Station' : 'Add Station'}
            </h2>

            {formError && (
              <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                <p className="text-sm text-red-400">{formError}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Station Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="input w-full"
                  placeholder="e.g. DWRR Manila"
                />
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Timezone</label>
                <input
                  type="text"
                  required
                  value={form.timezone}
                  onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
                  className="input w-full"
                  placeholder="Asia/Manila"
                />
              </div>

              {/* Broadcast Hours */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Broadcast Start Hour</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    required
                    value={form.broadcast_start_hour}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, broadcast_start_hour: Number(e.target.value) }))
                    }
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Broadcast End Hour</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    required
                    value={form.broadcast_end_hour}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, broadcast_end_hour: Number(e.target.value) }))
                    }
                    className="input w-full"
                  />
                </div>
              </div>

              {/* AI DJ Settings */}
              <div className="border-t border-[#2a2a40] pt-4">
                <label className="block text-sm text-gray-400 mb-3">AI DJ</label>
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.dj_enabled}
                      onChange={(e) => setForm((p) => ({ ...p, dj_enabled: e.target.checked }))}
                      className="rounded border-gray-600 w-4 h-4"
                    />
                    <div>
                      <span className="text-sm text-gray-300">Enable AI DJ</span>
                      <p className="text-xs text-gray-600">Allow AI-generated DJ scripts for this station</p>
                    </div>
                  </label>
                  {form.dj_enabled && (
                    <label className="flex items-center gap-3 cursor-pointer ml-7">
                      <input
                        type="checkbox"
                        checked={form.dj_auto_approve}
                        onChange={(e) => setForm((p) => ({ ...p, dj_auto_approve: e.target.checked }))}
                        className="rounded border-gray-600 w-4 h-4"
                      />
                      <div>
                        <span className="text-sm text-gray-300">Auto-approve scripts</span>
                        <p className="text-xs text-gray-600">Skip manual review — scripts go straight to approved</p>
                      </div>
                    </label>
                  )}
                </div>
              </div>

              {/* Active Days */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Active Days</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_DAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        form.active_days.includes(day)
                          ? 'bg-violet-600 text-white'
                          : 'bg-[#2a2a40] text-gray-400 hover:bg-[#34344f]'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : editingStation ? 'Save Changes' : 'Add Station'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
