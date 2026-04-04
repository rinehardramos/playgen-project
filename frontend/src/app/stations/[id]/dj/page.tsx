'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

type TtsProvider = 'openai' | 'elevenlabs';

interface PersonaConfig {
  catchphrases?: string[];
  signature_greeting?: string;
  signature_signoff?: string;
  topics_to_avoid?: string[];
  energy_level?: number;
  humor_level?: number;
  formality?: 'casual' | 'balanced' | 'formal';
  backstory?: string;
}

interface DjProfile {
  id: string;
  company_id: string;
  name: string;
  personality: string;
  voice_style: string;
  persona_config: PersonaConfig;
  llm_model: string;
  llm_temperature: number;
  tts_provider: TtsProvider;
  tts_voice_id: string;
  is_default: boolean;
  is_active: boolean;
}

interface Voice {
  id: string;
  name: string;
  provider: TtsProvider;
}

const DEFAULT_PERSONA: PersonaConfig = {
  energy_level: 5,
  humor_level: 5,
  formality: 'balanced',
  catchphrases: [],
};

const EMPTY_PROFILE: Partial<DjProfile> = {
  name: '',
  personality: '',
  voice_style: '',
  llm_model: 'anthropic/claude-sonnet-4-5',
  llm_temperature: 0.8,
  tts_provider: 'openai',
  tts_voice_id: 'alloy',
  is_default: false,
  is_active: true,
  persona_config: DEFAULT_PERSONA,
};

export default function DjProfilesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const stationId = params.id;
  const currentUser = getCurrentUser();
  const companyId = currentUser?.company_id ?? '';

  const [profiles, setProfiles] = useState<DjProfile[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generation settings (station-level)
  const [autoApprove, setAutoApprove] = useState(false);
  const [autoApproveLoading, setAutoApproveLoading] = useState(false);
  const [autoApproveError, setAutoApproveError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<DjProfile | null>(null);
  const [form, setForm] = useState<Partial<DjProfile>>(EMPTY_PROFILE);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [pData, vData, stationData] = await Promise.all([
        api.get<DjProfile[]>(`/api/v1/dj/profiles`),
        api.get<Voice[]>(`/api/v1/dj/tts/voices`),
        api.get<{ dj_auto_approve: boolean }>(`/api/v1/stations/${stationId}`),
      ]);
      setProfiles(pData);
      setVoices(vData);
      setAutoApprove(stationData.dj_auto_approve ?? false);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load DJ profiles');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleAutoApprove(value: boolean) {
    setAutoApproveLoading(true);
    setAutoApproveError(null);
    try {
      await api.put(`/api/v1/stations/${stationId}`, { dj_auto_approve: value });
      setAutoApprove(value);
    } catch (err: unknown) {
      setAutoApproveError((err as ApiError).message ?? 'Failed to update setting');
    } finally {
      setAutoApproveLoading(false);
    }
  }

  function openCreate() {
    setEditingProfile(null);
    setForm(EMPTY_PROFILE);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(profile: DjProfile) {
    setEditingProfile(profile);
    setForm({
      ...profile,
      persona_config: profile.persona_config || DEFAULT_PERSONA,
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (editingProfile) {
        await api.patch(`/api/v1/dj/profiles/${editingProfile.id}`, form);
      } else {
        await api.post(`/api/v1/dj/profiles`, form);
      }
      setModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      setFormError((err as ApiError).message ?? 'Failed to save DJ profile');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this DJ profile?')) return;
    try {
      await api.delete(`/api/v1/dj/profiles/${id}`);
      fetchData();
    } catch (err: unknown) {
      alert((err as ApiError).message ?? 'Failed to delete DJ profile');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/stations" className="text-xs text-gray-500 hover:text-violet-400 mb-1 inline-block">
            ← Back to Stations
          </Link>
          <h1 className="text-xl md:text-2xl font-bold text-white">DJ Personas</h1>
        </div>
        <button onClick={openCreate} className="btn-primary">
          + New Persona
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Generation Settings */}
      <div className="card p-5 mb-6 border border-[#2a2a40]">
        <h2 className="text-sm font-semibold text-white mb-4">Generation Settings</h2>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm text-gray-300 font-medium">Auto-approve scripts</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Skip review and generate audio immediately after script generation.
            </p>
            {autoApprove && (
              <div className="mt-2 flex items-center gap-1.5 text-amber-400 text-xs font-medium">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Scripts will not be reviewed before audio is generated
              </div>
            )}
            {autoApproveError && (
              <p className="mt-2 text-xs text-red-400">{autoApproveError}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {autoApproveLoading && (
              <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            )}
            <button
              role="switch"
              aria-checked={autoApprove}
              disabled={autoApproveLoading}
              onClick={() => handleToggleAutoApprove(!autoApprove)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-[#16161f] disabled:opacity-50 ${
                autoApprove ? 'bg-violet-600' : 'bg-gray-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  autoApprove ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {profiles.length === 0 ? (
          <div className="col-span-full py-12 text-center text-gray-600 card">
            No DJ personas found. Create one to get started.
          </div>
        ) : (
          profiles.map((profile) => (
            <div key={profile.id} className="card p-5 flex flex-col h-full relative group">
              {profile.is_default && (
                <span className="absolute top-4 right-4 bg-violet-900/40 text-violet-400 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border border-violet-500/20">
                  Default
                </span>
              )}
              
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-violet-600/20 flex items-center justify-center text-violet-400 text-xl font-bold border border-violet-500/10">
                  {profile.name[0]}
                </div>
                <div>
                  <h3 className="font-semibold text-white">{profile.name}</h3>
                  <p className="text-xs text-gray-500 capitalize">{profile.tts_provider} — {voices.find(v => v.id === profile.tts_voice_id)?.name || profile.tts_voice_id}</p>
                </div>
              </div>

              <p className="text-sm text-gray-400 line-clamp-3 mb-6 flex-1 italic">
                "{profile.personality}"
              </p>

              <div className="flex items-center gap-2 pt-4 border-t border-[#2a2a40]">
                <button
                  onClick={() => openEdit(profile)}
                  className="text-xs text-violet-400 hover:text-violet-300 font-medium px-2 py-1 rounded hover:bg-violet-500/10 transition-colors"
                >
                  Edit
                </button>
                {!profile.is_default && (
                  <button
                    onClick={() => handleDelete(profile.id)}
                    className="text-xs text-red-400 hover:text-red-300 font-medium px-2 py-1 rounded hover:bg-red-500/10 transition-colors ml-auto"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-[#2a2a40] flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">
                {editingProfile ? 'Edit Persona' : 'Create New Persona'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-500 hover:text-white text-xl">×</button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6">
              {formError && (
                <div className="rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                  <p className="text-sm text-red-400">{formError}</p>
                </div>
              )}

              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Persona Name</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="input w-full"
                    placeholder="e.g. DJ Alex"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">LLM Model</label>
                  <select
                    value={form.llm_model}
                    onChange={(e) => setForm((p) => ({ ...p, llm_model: e.target.value }))}
                    className="input w-full"
                  >
                    <option value="anthropic/claude-sonnet-4-5">Claude 3.5 Sonnet</option>
                    <option value="openai/gpt-4o">GPT-4o</option>
                    <option value="google/gemini-pro-1.5">Gemini 1.5 Pro</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Core Personality Description</label>
                <textarea
                  required
                  value={form.personality}
                  onChange={(e) => setForm((p) => ({ ...p, personality: e.target.value }))}
                  className="input w-full h-24"
                  placeholder="e.g. A high-energy morning show host who loves 80s pop and tells dad jokes."
                />
              </div>

              {/* Persona Config Sliders */}
              <div className="bg-[#0f0f1a] rounded-xl p-4 border border-[#2a2a40] grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="flex justify-between text-sm text-gray-400 mb-2">
                    <span>Energy Level</span>
                    <span className="text-violet-400 font-mono">{form.persona_config?.energy_level}</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={form.persona_config?.energy_level ?? 5}
                    onChange={(e) => setForm((p) => ({
                      ...p,
                      persona_config: { ...p.persona_config!, energy_level: Number(e.target.value) }
                    }))}
                    className="w-full accent-violet-600 h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <div>
                  <label className="flex justify-between text-sm text-gray-400 mb-2">
                    <span>Humor Level</span>
                    <span className="text-violet-400 font-mono">{form.persona_config?.humor_level}</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={form.persona_config?.humor_level ?? 5}
                    onChange={(e) => setForm((p) => ({
                      ...p,
                      persona_config: { ...p.persona_config!, humor_level: Number(e.target.value) }
                    }))}
                    className="w-full accent-violet-600 h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>

              {/* TTS Config */}
              <div className="border-t border-[#2a2a40] pt-6">
                <h3 className="text-sm font-semibold text-white mb-4">Voice Configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1.5">TTS Provider</label>
                    <select
                      value={form.tts_provider}
                      onChange={(e) => setForm((p) => ({ ...p, tts_provider: e.target.value as TtsProvider }))}
                      className="input w-full"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="elevenlabs">ElevenLabs</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1.5">Voice Persona</label>
                    <select
                      value={form.tts_voice_id}
                      onChange={(e) => setForm((p) => ({ ...p, tts_voice_id: e.target.value }))}
                      className="input w-full"
                    >
                      {voices
                        .filter((v) => v.provider === form.tts_provider)
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))}
                    className="rounded border-gray-600 w-4 h-4"
                  />
                  <span className="text-sm text-gray-300">Set as default persona for station</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[#2a2a40]">
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
                  {submitting ? 'Saving…' : editingProfile ? 'Save Changes' : 'Create Persona'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
