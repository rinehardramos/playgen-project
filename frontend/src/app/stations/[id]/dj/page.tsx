'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError, DjProfile, TtsProvider, PersonaConfig } from '@playgen/types';

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
      const [pData, vData] = await Promise.all([
        api.get<DjProfile[]>(`/api/v1/dj/profiles`),
        api.get<Voice[]>(`/api/v1/dj/tts/voices`),
      ]);
      setProfiles(pData);
      setVoices(vData);
    } catch (err: unknown) {
      setError((err as ApiError).error?.message ?? 'Failed to load DJ profiles');
    } finally {
      setLoading(false);
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
      setFormError((err as ApiError).error?.message ?? 'Failed to save DJ profile');
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
      alert((err as ApiError).error?.message ?? 'Failed to delete DJ profile');
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
