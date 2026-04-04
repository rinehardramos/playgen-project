'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface DjProfile {
  id: string;
  name: string;
  personality: string;
  voice_style: string;
  llm_model: string;
  llm_temperature: number;
  tts_provider: string;
  tts_voice_id: string;
  is_default: boolean;
  is_active: boolean;
}

const EMPTY_FORM: Omit<DjProfile, 'id'> = {
  name: '',
  personality: '',
  voice_style: 'energetic',
  llm_model: 'anthropic/claude-sonnet-4-5',
  llm_temperature: 0.8,
  tts_provider: 'openai',
  tts_voice_id: 'alloy',
  is_default: false,
  is_active: true,
};

export default function DjProfilesPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();

  const [profiles, setProfiles] = useState<DjProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!currentUser) { router.replace('/login'); return; }
    fetchProfiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchProfiles() {
    setLoading(true);
    try {
      const data = await api.get<DjProfile[]>('/api/v1/dj/profiles');
      setProfiles(data);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(p: DjProfile) {
    setForm({
      name: p.name,
      personality: p.personality,
      voice_style: p.voice_style,
      llm_model: p.llm_model,
      llm_temperature: p.llm_temperature,
      tts_provider: p.tts_provider,
      tts_voice_id: p.tts_voice_id,
      is_default: p.is_default,
      is_active: p.is_active,
    });
    setEditingId(p.id);
    setShowForm(true);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      if (editingId) {
        await api.post(`/api/v1/dj/profiles/${editingId}`, form);
      } else {
        await api.post('/api/v1/dj/profiles', form);
      }
      setShowForm(false);
      await fetchProfiles();
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to save profile');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/v1/dj/profiles/${id}`);
      await fetchProfiles();
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to delete profile');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-[#0b0b10]">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">DJ Profiles</h1>
          <p className="text-sm text-gray-500 mt-1">Manage AI DJ personas for your stations</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-sm px-4 py-2">
          + New Profile
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {profiles.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 gap-4">
          <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
          </svg>
          <p className="text-gray-500 text-sm">No DJ profiles yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <div key={p.id} className="card p-5 border border-[#2a2a40] hover:border-[#3a3a50] transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-violet-600/30 flex items-center justify-center text-violet-300 font-bold">
                    {p.name[0]}
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">{p.name}</h3>
                    <span className="text-xs text-gray-500 capitalize">{p.voice_style}</span>
                  </div>
                </div>
                {p.is_default && (
                  <span className="badge bg-violet-900/30 text-violet-400 text-xs">Default</span>
                )}
              </div>
              <p className="text-sm text-gray-400 line-clamp-2 mb-3">{p.personality}</p>
              <div className="flex items-center gap-2 text-xs text-gray-600 mb-4">
                <span>{p.llm_model.split('/').pop()}</span>
                <span>|</span>
                <span>TTS: {p.tts_provider}/{p.tts_voice_id}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(p)} className="text-xs text-violet-400 hover:text-violet-300 font-medium">
                  Edit
                </button>
                {!p.is_default && (
                  <button onClick={() => handleDelete(p.id)} className="text-xs text-red-400 hover:text-red-300 font-medium">
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-white mb-4">
              {editingId ? 'Edit' : 'Create'} DJ Profile
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input w-full mt-1"
                  placeholder="e.g. Alex"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium">Personality</label>
                <textarea
                  value={form.personality}
                  onChange={(e) => setForm({ ...form, personality: e.target.value })}
                  className="input w-full mt-1"
                  rows={3}
                  placeholder="Describe the DJ's personality, tone, and style..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Voice Style</label>
                  <select
                    value={form.voice_style}
                    onChange={(e) => setForm({ ...form, voice_style: e.target.value })}
                    className="input w-full mt-1"
                  >
                    <option value="energetic">Energetic</option>
                    <option value="calm">Calm</option>
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="dramatic">Dramatic</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">LLM Model</label>
                  <input
                    value={form.llm_model}
                    onChange={(e) => setForm({ ...form, llm_model: e.target.value })}
                    className="input w-full mt-1"
                    placeholder="anthropic/claude-sonnet-4-5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 font-medium">TTS Provider</label>
                  <select
                    value={form.tts_provider}
                    onChange={(e) => setForm({ ...form, tts_provider: e.target.value })}
                    className="input w-full mt-1"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="elevenlabs">ElevenLabs</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">TTS Voice</label>
                  <input
                    value={form.tts_voice_id}
                    onChange={(e) => setForm({ ...form, tts_voice_id: e.target.value })}
                    className="input w-full mt-1"
                    placeholder="alloy"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                    className="rounded border-gray-600"
                  />
                  Default profile
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowForm(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !form.name.trim()}
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
