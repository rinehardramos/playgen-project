'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

const SEGMENT_TYPES = [
  'show_intro',
  'song_intro',
  'song_transition',
  'show_outro',
  'station_id',
  'time_check',
  'weather_tease',
  'ad_break',
  'current_events',
  'listener_activity',
  'joke',
] as const;

type SegmentType = (typeof SEGMENT_TYPES)[number];

interface Station {
  id: string;
  name: string;
  is_active: boolean;
}

interface ScriptTemplate {
  id: string;
  station_id: string;
  segment_type: SegmentType;
  name: string;
  prompt_template: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface FormData {
  name: string;
  segment_type: SegmentType;
  prompt_template: string;
  is_active: boolean;
}

const EMPTY_FORM: FormData = {
  name: '',
  segment_type: 'show_intro',
  prompt_template: '',
  is_active: true,
};

const PLACEHOLDER_HINTS = [
  '{{station_name}}',
  '{{current_date}}',
  '{{next_song_title}}',
  '{{next_song_artist}}',
  '{{prev_song_title}}',
  '{{prev_song_artist}}',
];

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export default function DjTemplatesPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();

  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string>('');
  const [templates, setTemplates] = useState<ScriptTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchStations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedStationId) {
      fetchTemplates(selectedStationId);
    } else {
      setTemplates([]);
    }
  }, [selectedStationId]);

  async function fetchStations() {
    setStationsLoading(true);
    try {
      const data = await api.get<Station[]>('/api/v1/stations');
      const activeStations = data.filter((s) => s.is_active);
      setStations(activeStations);
      // Auto-select the first station the user has access to
      const userStationIds = currentUser?.station_ids ?? [];
      const firstMatch =
        activeStations.find((s) => userStationIds.includes(s.id)) ?? activeStations[0];
      if (firstMatch) setSelectedStationId(firstMatch.id);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load stations');
    } finally {
      setStationsLoading(false);
    }
  }

  async function fetchTemplates(stationId: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ScriptTemplate[]>(
        `/api/v1/dj/stations/${stationId}/script-templates`,
      );
      setTemplates(data);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(t: ScriptTemplate) {
    setForm({
      name: t.name,
      segment_type: t.segment_type,
      prompt_template: t.prompt_template,
      is_active: t.is_active,
    });
    setEditingId(t.id);
    setShowForm(true);
  }

  async function handleSubmit() {
    if (!selectedStationId) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editingId) {
        await api.patch(
          `/api/v1/dj/stations/${selectedStationId}/script-templates/${editingId}`,
          { name: form.name, prompt_template: form.prompt_template, is_active: form.is_active },
        );
      } else {
        await api.post(
          `/api/v1/dj/stations/${selectedStationId}/script-templates`,
          form,
        );
      }
      setShowForm(false);
      await fetchTemplates(selectedStationId);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to save template');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!selectedStationId) return;
    setDeleting(true);
    try {
      await api.delete(`/api/v1/dj/stations/${selectedStationId}/script-templates/${id}`);
      setDeleteConfirmId(null);
      await fetchTemplates(selectedStationId);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to delete template');
    } finally {
      setDeleting(false);
    }
  }

  const selectedStation = stations.find((s) => s.id === selectedStationId);

  if (stationsLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-[#0b0b10]">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Script Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage AI DJ prompt templates per segment type
          </p>
        </div>
        <button
          onClick={openCreate}
          disabled={!selectedStationId}
          className="btn-primary text-sm px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + New Template
        </button>
      </div>

      {/* Station selector */}
      <div className="mb-6">
        <label className="text-xs text-gray-500 font-medium block mb-1.5">Station</label>
        {stations.length === 0 ? (
          <p className="text-sm text-gray-500">No active stations found.</p>
        ) : (
          <select
            value={selectedStationId}
            onChange={(e) => setSelectedStationId(e.target.value)}
            className="input w-full max-w-xs"
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Templates table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !selectedStationId ? null : templates.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 gap-4">
          <svg
            className="w-12 h-12 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="text-gray-500 text-sm">
            No script templates for {selectedStation?.name ?? 'this station'}. Create one to get
            started.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Segment count summary */}
          <div className="flex flex-wrap gap-2">
            {SEGMENT_TYPES.filter((st) => templates.some((t) => t.segment_type === st)).map((st) => {
              const count = templates.filter((t) => t.segment_type === st).length;
              return (
                <span key={st} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-[#1a1a28] border border-[#2a2a40] text-gray-400">
                  <span className="font-mono text-violet-400">{st}</span>
                  <span className="bg-[#2a2a40] text-gray-300 rounded-full px-1.5 py-0.5 text-[10px] font-bold">{count}</span>
                </span>
              );
            })}
          </div>
        <div className="card overflow-hidden border border-[#2a2a40]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a40] text-left">
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Segment Type
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                  Prompt Preview
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                  Created
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a40]">
              {templates.map((t) => (
                <tr key={t.id} className="hover:bg-[#1a1a28] transition-colors">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-900/30 text-violet-300 text-xs font-mono">
                      {t.segment_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-gray-400 hidden md:table-cell font-mono text-xs">
                    {truncate(t.prompt_template, 80)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">
                    {new Date(t.created_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        t.is_active
                          ? 'bg-emerald-900/30 text-emerald-400'
                          : 'bg-gray-800 text-gray-500'
                      }`}
                    >
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => openEdit(t)}
                        className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(t.id)}
                        className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-white mb-4">
              {editingId ? 'Edit' : 'New'} Script Template
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input w-full mt-1"
                  placeholder="e.g. Standard Show Intro"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium">Segment Type</label>
                <select
                  value={form.segment_type}
                  onChange={(e) =>
                    setForm({ ...form, segment_type: e.target.value as SegmentType })
                  }
                  disabled={!!editingId}
                  className="input w-full mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {SEGMENT_TYPES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                {editingId && (
                  <p className="text-xs text-gray-600 mt-1">
                    Segment type cannot be changed after creation.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium">Prompt Template</label>
                <textarea
                  value={form.prompt_template}
                  onChange={(e) => setForm({ ...form, prompt_template: e.target.value })}
                  className="input w-full mt-1 font-mono text-xs"
                  rows={6}
                  placeholder="Write the prompt for the LLM. Use {{variable}} placeholders."
                />
                {/* Placeholder hints */}
                <div className="mt-2 p-3 bg-[#0f0f1a] border border-[#2a2a40] rounded-lg">
                  <p className="text-xs text-gray-500 mb-2 font-medium">
                    Available placeholders:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEHOLDER_HINTS.map((ph) => (
                      <button
                        key={ph}
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            prompt_template: prev.prompt_template + ph,
                          }))
                        }
                        className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-900/20 text-violet-300 text-xs font-mono hover:bg-violet-900/40 transition-colors"
                        title="Click to insert"
                      >
                        {ph}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded border-gray-600 accent-violet-500"
                />
                <label htmlFor="is_active" className="text-sm text-gray-400">
                  Active
                </label>
              </div>
            </div>

            {error && (
              <div className="mt-3 bg-red-900/30 border border-red-700/50 text-red-400 px-3 py-2 rounded-lg text-xs">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  setShowForm(false);
                  setError(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !form.name.trim() || !form.prompt_template.trim()}
                className="btn-primary px-4 py-2 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-2">Delete Template?</h2>
            <p className="text-sm text-gray-400 mb-6">
              This action cannot be undone. The script template will be permanently removed.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                disabled={deleting}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
