'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

type TemplateType = '1_day' | '3_hour' | '4_hour';

interface Template {
  id: string;
  name: string;
  type: TemplateType;
  is_default: boolean;
  station_id: string;
}

interface Station {
  id: string;
  name: string;
}

interface TemplateFormData {
  name: string;
  type: TemplateType;
  is_default: boolean;
}

const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  '1_day': '1 Day',
  '3_hour': '3 Hour',
  '4_hour': '4 Hour',
};

const EMPTY_FORM: TemplateFormData = {
  name: '',
  type: '1_day',
  is_default: false,
};

export default function TemplatesPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const companyId = currentUser?.company_id ?? '';

  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloningTemplate, setCloningTemplate] = useState<Template | null>(null);
  const [targetStation, setTargetStation] = useState<string>('');
  const [formData, setFormData] = useState<TemplateFormData>(EMPTY_FORM);
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

  useEffect(() => {
    if (selectedStation) {
      fetchTemplates(selectedStation);
      setTargetStation(selectedStation);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation]);

  async function fetchStations() {
    try {
      const data = await api.get<Station[]>(`/api/v1/companies/${companyId}/stations`);
      setStations(data);
      if (data.length > 0) {
        setSelectedStation(data[0].id);
        setTargetStation(data[0].id);
      }
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load stations');
    }
  }

  async function fetchTemplates(stationId: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Template[]>(`/api/v1/stations/${stationId}/templates`);
      setTemplates(data);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post<Template>(`/api/v1/stations/${selectedStation}/templates`, {
        ...formData,
        station_id: selectedStation,
      });
      setModalOpen(false);
      setFormData(EMPTY_FORM);
      await fetchTemplates(selectedStation);
    } catch (err: unknown) {
      setFormError((err as ApiError).message ?? 'Failed to create template');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClone(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cloningTemplate) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post(`/api/v1/templates/${cloningTemplate.id}/clone`, {
        target_station_id: targetStation,
      });
      setCloneModalOpen(false);
      setCloningTemplate(null);
      if (targetStation === selectedStation) {
        await fetchTemplates(selectedStation);
      }
    } catch (err: unknown) {
      setFormError((err as ApiError).message ?? 'Failed to clone template');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Templates</h1>
        <button
          onClick={() => {
            setFormData(EMPTY_FORM);
            setFormError(null);
            setModalOpen(true);
          }}
          disabled={!selectedStation}
          className="btn-primary disabled:opacity-50"
        >
          + New Template
        </button>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.length === 0 ? (
            <p className="text-gray-600 col-span-3 text-center py-12">
              No templates yet. Create your first template.
            </p>
          ) : (
            templates.map((tpl) => (
              <div
                key={tpl.id}
                className="card p-5 hover:bg-[#24243a] transition-colors flex flex-col gap-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-white">{tpl.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {TEMPLATE_TYPE_LABELS[tpl.type]}
                    </p>
                  </div>
                  {tpl.is_default && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-900/30 text-violet-400">
                      Default
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/templates/${tpl.id}/builder`}
                    className="btn-secondary text-sm flex-1 text-center"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => {
                      setCloningTemplate(tpl);
                      setTargetStation(selectedStation);
                      setFormError(null);
                      setCloneModalOpen(true);
                    }}
                    className="btn-secondary text-sm px-3"
                    title="Clone Template"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* New Template Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">New Template</h2>
            {formError && (
              <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                <p className="text-sm text-red-400">{formError}</p>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  className="input w-full"
                  placeholder="Weekday Morning"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData((p) => ({ ...p, type: e.target.value as TemplateType }))}
                  className="input w-full"
                >
                  {(Object.entries(TEMPLATE_TYPE_LABELS) as [TemplateType, string][]).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="is_default"
                  type="checkbox"
                  checked={formData.is_default}
                  onChange={(e) => setFormData((p) => ({ ...p, is_default: e.target.checked }))}
                  className="rounded border-[#2a2a40] text-violet-600 focus:ring-violet-500 bg-[#24243a]"
                />
                <label htmlFor="is_default" className="text-sm text-gray-400">
                  Set as default template
                </label>
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
                  {submitting ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clone Template Modal */}
      {cloneModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-1">Clone Template</h2>
            <p className="text-xs text-gray-500 mb-4">Copy "{cloningTemplate?.name}" to another station.</p>
            
            {formError && (
              <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                <p className="text-sm text-red-400">{formError}</p>
              </div>
            )}
            
            <form onSubmit={handleClone} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Target Station</label>
                <select
                  value={targetStation}
                  onChange={(e) => setTargetStation(e.target.value)}
                  className="input w-full"
                  required
                >
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.id === selectedStation ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setCloneModalOpen(false);
                    setCloningTemplate(null);
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary disabled:opacity-50"
                >
                  {submitting ? 'Cloning…' : 'Clone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
