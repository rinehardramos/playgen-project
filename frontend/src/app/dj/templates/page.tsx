'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type DjSegmentType =
  | 'show_intro'
  | 'song_intro'
  | 'song_transition'
  | 'show_outro'
  | 'station_id'
  | 'time_check'
  | 'weather_tease'
  | 'ad_break';

interface DjScriptTemplate {
  id: string;
  station_id: string;
  segment_type: DjSegmentType;
  name: string;
  prompt_template: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Station {
  id: string;
  name: string;
  is_active: boolean;
}

interface TemplateFormData {
  name: string;
  segment_type: DjSegmentType;
  prompt_template: string;
  is_active: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SEGMENT_TYPE_LABELS: Record<DjSegmentType, string> = {
  show_intro: 'Show Intro',
  song_intro: 'Song Intro',
  song_transition: 'Song Transition',
  show_outro: 'Show Outro',
  station_id: 'Station ID',
  time_check: 'Time Check',
  weather_tease: 'Weather Tease',
  ad_break: 'Ad Break',
};

const SEGMENT_TYPES = Object.keys(SEGMENT_TYPE_LABELS) as DjSegmentType[];

const TEMPLATE_VARIABLES = [
  '{{song_title}}',
  '{{artist}}',
  '{{station_name}}',
  '{{dj_name}}',
  '{{time_of_day}}',
];

const EMPTY_FORM: TemplateFormData = {
  name: '',
  segment_type: 'song_intro',
  prompt_template: '',
  is_active: true,
};

// ─── Variable Chip Helper ────────────────────────────────────────────────────

function VariableChips({
  textareaRef,
  onInsert,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onInsert: (updated: string) => void;
}) {
  function insertVariable(variable: string) {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const updated = before + variable + after;
    onInsert(updated);

    // Restore cursor after the inserted variable
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + variable.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {TEMPLATE_VARIABLES.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => insertVariable(v)}
          className="px-2 py-0.5 rounded-md bg-violet-900/30 text-violet-300 text-xs font-mono hover:bg-violet-700/30 hover:text-violet-200 transition-colors"
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DjTemplatesPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();

  // Station selection
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string>('');

  // Templates list
  const [templates, setTemplates] = useState<DjScriptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Inline delete confirmation: maps template id → countdown timer id
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Textarea ref for variable insertion
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load stations ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;

    async function loadStations() {
      try {
        const data = await api.get<Station[]>('/api/v1/stations');
        setStations(data);
        if (data.length > 0) {
          setSelectedStationId(data[0].id);
        }
      } catch (err: unknown) {
        setError((err as ApiError).message ?? 'Failed to load stations');
        setLoading(false);
      }
    }

    loadStations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load templates when station changes ───────────────────────────────────
  useEffect(() => {
    if (!selectedStationId) return;
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStationId]);

  async function fetchTemplates() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<DjScriptTemplate[]>(
        `/api/v1/dj/stations/${selectedStationId}/script-templates`
      );
      setTemplates(data);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(t: DjScriptTemplate) {
    setForm({
      name: t.name,
      segment_type: t.segment_type,
      prompt_template: t.prompt_template,
      is_active: t.is_active,
    });
    setEditingId(t.id);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!form.name.trim() || !form.prompt_template.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = { ...form, station_id: selectedStationId };
      if (editingId) {
        await api.put(
          `/api/v1/dj/stations/${selectedStationId}/script-templates/${editingId}`,
          payload
        );
      } else {
        await api.post(
          `/api/v1/dj/stations/${selectedStationId}/script-templates`,
          payload
        );
      }
      closeModal();
      await fetchTemplates();
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to save template');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Delete with inline confirm ────────────────────────────────────────────
  function requestDelete(id: string) {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmDeleteId(id);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmDeleteId(null);
    }, 3000);
  }

  async function confirmDelete(id: string) {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmDeleteId(null);
    try {
      await api.delete(`/api/v1/dj/stations/${selectedStationId}/script-templates/${id}`);
      await fetchTemplates();
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to delete template');
    }
  }

  // ── Loading spinner (full page, before station loads) ────────────────────
  if (loading && stations.length === 0) {
    return (
      <div
        data-testid="loading-spinner"
        className="flex justify-center items-center min-h-screen bg-[#0b0b10]"
      >
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Script Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage AI DJ prompt templates for each segment type
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Station selector — only show if multiple stations */}
          {stations.length > 1 && (
            <select
              value={selectedStationId}
              onChange={(e) => setSelectedStationId(e.target.value)}
              className="input text-sm"
              aria-label="Select station"
            >
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={openCreate}
            disabled={!selectedStationId}
            className="btn-primary text-sm px-4 py-2 whitespace-nowrap"
          >
            + New Template
          </button>
        </div>
      </div>

      {/* ── Error banner ──────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* ── Loading templates ─────────────────────────────────────────── */}
      {loading && stations.length > 0 ? (
        <div
          data-testid="loading-spinner"
          className="flex justify-center items-center py-20"
        >
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !selectedStationId ? (
        /* No stations at all */
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
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
          <p className="text-gray-500 text-sm">No stations found. Create a station first.</p>
        </div>
      ) : templates.length === 0 ? (
        /* Empty state */
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
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-gray-500 text-sm">No templates yet. Create one to get started.</p>
          <button onClick={openCreate} className="btn-primary text-sm px-4 py-2">
            + New Template
          </button>
        </div>
      ) : (
        /* ── Templates Table ──────────────────────────────────────────── */
        <div className="card overflow-hidden">
          <table className="w-full text-sm" data-testid="templates-table">
            <thead>
              <tr className="border-b border-[#2a2a40]">
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wide">
                  Name
                </th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wide">
                  Segment Type
                </th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wide">
                  Active
                </th>
                <th className="text-right px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-[#1e1e2e] hover:bg-[#1a1a28] transition-colors"
                >
                  <td className="px-5 py-3 text-white font-medium">{t.name}</td>
                  <td className="px-5 py-3 text-gray-400">
                    {SEGMENT_TYPE_LABELS[t.segment_type] ?? t.segment_type}
                  </td>
                  <td className="px-5 py-3">
                    {t.is_active ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700/30 text-gray-500 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => openEdit(t)}
                        className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
                      >
                        Edit
                      </button>
                      {confirmDeleteId === t.id ? (
                        <button
                          onClick={() => confirmDelete(t.id)}
                          className="text-xs text-red-300 bg-red-900/40 hover:bg-red-900/60 font-medium px-2 py-0.5 rounded transition-colors"
                        >
                          Confirm?
                        </button>
                      ) : (
                        <button
                          onClick={() => requestDelete(t.id)}
                          className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create / Edit Modal ────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-xl bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-white mb-5">
              {editingId ? 'Edit' : 'Create'} Script Template
            </h2>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="text-xs text-gray-500 font-medium">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input w-full mt-1"
                  placeholder="e.g. Morning Song Intro"
                />
              </div>

              {/* Segment Type */}
              <div>
                <label className="text-xs text-gray-500 font-medium">Segment Type</label>
                <select
                  value={form.segment_type}
                  onChange={(e) =>
                    setForm({ ...form, segment_type: e.target.value as DjSegmentType })
                  }
                  className="input w-full mt-1"
                >
                  {SEGMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {SEGMENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Prompt Template */}
              <div>
                <label className="text-xs text-gray-500 font-medium">
                  Prompt Template
                </label>
                <p className="text-xs text-gray-600 mt-0.5 mb-1">
                  Use the chips below to insert variables at the cursor position.
                </p>
                <textarea
                  ref={textareaRef}
                  value={form.prompt_template}
                  onChange={(e) =>
                    setForm({ ...form, prompt_template: e.target.value })
                  }
                  className="input w-full mt-1 font-mono text-sm"
                  rows={7}
                  placeholder="Write a brief, energetic intro for {{song_title}} by {{artist}}. The DJ is {{dj_name}} on {{station_name}}. Keep it under 20 seconds."
                />
                <VariableChips
                  textareaRef={textareaRef}
                  onInsert={(updated) =>
                    setForm({ ...form, prompt_template: updated })
                  }
                />
              </div>

              {/* Is Active */}
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="rounded border-gray-600 accent-violet-500"
                  />
                  Active
                </label>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={closeModal} className="btn-secondary">
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
    </div>
  );
}
