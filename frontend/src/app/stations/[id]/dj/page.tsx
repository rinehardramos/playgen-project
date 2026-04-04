'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError, DjProfile, TtsProvider, PersonaConfig, DjScriptTemplate, DjSegmentType } from '@playgen/types';

interface Voice {
  id: string;
  name: string;
  provider: TtsProvider;
}

type TabView = 'personas' | 'templates';

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

const EMPTY_TEMPLATE: Partial<DjScriptTemplate> = {
  name: '',
  segment_type: 'song_intro' as DjSegmentType,
  prompt_template: '',
  is_active: true,
};

const SEGMENT_TYPES: { value: DjSegmentType; label: string }[] = [
  { value: 'show_intro', label: 'Show Intro' },
  { value: 'song_intro', label: 'Song Intro' },
  { value: 'song_transition', label: 'Song Transition' },
  { value: 'show_outro', label: 'Show Outro' },
  { value: 'station_id', label: 'Station ID' },
  { value: 'time_check', label: 'Time Check' },
  { value: 'weather_tease', label: 'Weather Tease' },
  { value: 'ad_break', label: 'Ad Break' },
];

const TEMPLATE_VARIABLES = [
  { name: 'station_name', desc: 'The name of the radio station' },
  { name: 'dj_name', desc: 'The name of the current DJ' },
  { name: 'current_date', desc: 'Today\'s date (YYYY-MM-DD)' },
  { name: 'current_hour', desc: 'The current broadcast hour' },
  { name: 'song_title', desc: 'Title of the current/upcoming song' },
  { name: 'artist', desc: 'Artist of the current/upcoming song' },
  { name: 'next_song', desc: 'Title of the following song' },
];

export default function DjManagementPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const stationId = params.id;
  const currentUser = getCurrentUser();

  const [activeTab, setActiveTab] = useState<TabView>('personas');
  const [profiles, setProfiles] = useState<DjProfile[]>([]);
  const [templates, setTemplates] = useState<DjScriptTemplate[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persona Modal state
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<DjProfile | null>(null);
  const [personaForm, setPersonaForm] = useState<Partial<DjProfile>>(EMPTY_PROFILE);

  // Template Modal state
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<DjScriptTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<Partial<DjScriptTemplate>>(EMPTY_TEMPLATE);

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
      const [pData, vData, tData] = await Promise.all([
        api.get<DjProfile[]>(`/api/v1/dj/profiles`),
        api.get<Voice[]>(`/api/v1/dj/tts/voices`),
        api.get<DjScriptTemplate[]>(`/api/v1/dj/stations/${stationId}/script-templates`),
      ]);
      setProfiles(pData);
      setVoices(vData);
      setTemplates(tData);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load DJ settings');
    } finally {
      setLoading(false);
    }
  }

  // --- Persona Handlers ---
  function openPersonaCreate() {
    setEditingProfile(null);
    setPersonaForm(EMPTY_PROFILE);
    setFormError(null);
    setPersonaModalOpen(true);
  }

  function openPersonaEdit(profile: DjProfile) {
    setEditingProfile(profile);
    setPersonaForm({ ...profile, persona_config: profile.persona_config || DEFAULT_PERSONA });
    setFormError(null);
    setPersonaModalOpen(true);
  }

  async function handlePersonaSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (editingProfile) {
        await api.patch(`/api/v1/dj/profiles/${editingProfile.id}`, personaForm);
      } else {
        await api.post(`/api/v1/dj/profiles`, personaForm);
      }
      setPersonaModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      setFormError((err as ApiError).message ?? 'Failed to save DJ profile');
    } finally {
      setSubmitting(false);
    }
  }

  // --- Template Handlers ---
  function openTemplateCreate() {
    setEditingTemplate(null);
    setTemplateForm(EMPTY_TEMPLATE);
    setFormError(null);
    setTemplateModalOpen(true);
  }

  function openTemplateEdit(tpl: DjScriptTemplate) {
    setEditingTemplate(tpl);
    setTemplateForm(tpl);
    setFormError(null);
    setTemplateModalOpen(true);
  }

  async function handleTemplateSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (editingTemplate) {
        await api.patch(`/api/v1/dj/stations/${stationId}/script-templates/${editingTemplate.id}`, templateForm);
      } else {
        await api.post(`/api/v1/dj/stations/${stationId}/script-templates`, templateForm);
      }
      setTemplateModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      setFormError((err as ApiError).message ?? 'Failed to save template');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTemplateDelete(id: string) {
    if (!confirm('Are you sure you want to delete this script template?')) return;
    try {
      await api.delete(`/api/v1/dj/stations/${stationId}/script-templates/${id}`);
      fetchData();
    } catch (err: unknown) {
      alert((err as ApiError).message ?? 'Failed to delete template');
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
          <h1 className="text-xl md:text-2xl font-bold text-white">DJ Management</h1>
        </div>
        <button 
          onClick={activeTab === 'personas' ? openPersonaCreate : openTemplateCreate} 
          className="btn-primary"
        >
          {activeTab === 'personas' ? '+ New Persona' : '+ New Template'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[#2a2a40]">
        <button
          onClick={() => setActiveTab('personas')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'personas' ? 'border-violet-500 text-violet-300' : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Personas
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'templates' ? 'border-violet-500 text-violet-300' : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Script Templates
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Personas Content */}
      {activeTab === 'personas' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {profiles.map((profile) => (
            <div key={profile.id} className="card p-5 relative">
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
              <p className="text-sm text-gray-400 line-clamp-3 mb-6 italic">"{profile.personality}"</p>
              <div className="flex items-center gap-2 pt-4 border-t border-[#2a2a40]">
                <button onClick={() => openPersonaEdit(profile)} className="text-xs text-violet-400 hover:text-violet-300 font-medium">Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Templates Content */}
      {activeTab === 'templates' && (
        <div className="space-y-8">
          {SEGMENT_TYPES.map((type) => {
            const typeTemplates = templates.filter(t => t.segment_type === type.value);
            return (
              <div key={type.value}>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-3">
                  {type.label}
                  <div className="h-px bg-[#2a2a40] flex-1" />
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {typeTemplates.length === 0 ? (
                    <div className="col-span-full py-6 text-center text-gray-600 text-sm border border-dashed border-[#2a2a40] rounded-xl">
                      Using system default template for {type.label}.
                    </div>
                  ) : (
                    typeTemplates.map((tpl) => (
                      <div key={tpl.id} className="card p-4 border border-[#2a2a40] hover:border-[#3a3a50] transition-colors group">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-medium text-white">{tpl.name}</h4>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openTemplateEdit(tpl)} className="text-xs text-violet-400 font-medium">Edit</button>
                            <button onClick={() => handleTemplateDelete(tpl.id)} className="text-xs text-red-400 font-medium">Delete</button>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 font-mono line-clamp-3 bg-[#0f0f1a] p-2 rounded border border-[#2a2a40] mt-2 whitespace-pre-wrap">
                          {tpl.prompt_template}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Persona Modal */}
      {personaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-[#2a2a40] flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">{editingProfile ? 'Edit Persona' : 'Create New Persona'}</h2>
              <button onClick={() => setPersonaModalOpen(false)} className="text-gray-500 hover:text-white text-xl">×</button>
            </div>
            <form onSubmit={handlePersonaSubmit} className="overflow-y-auto p-6 space-y-6">
              {formError && <div className="rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3 text-sm text-red-400">{formError}</div>}
              {/* Persona Fields... */}
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Name</label>
                <input type="text" required value={personaForm.name} onChange={(e) => setPersonaForm(p => ({...p, name: e.target.value}))} className="input w-full" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Personality Description</label>
                <textarea required value={personaForm.personality} onChange={(e) => setPersonaForm(p => ({...p, personality: e.target.value}))} className="input w-full h-24" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-[#2a2a40]">
                <button type="button" onClick={() => setPersonaModalOpen(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary">{submitting ? 'Saving...' : 'Save Persona'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Template Modal */}
      {templateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-3xl bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-[#2a2a40] flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">{editingTemplate ? 'Edit Template' : 'New Script Template'}</h2>
              <button onClick={() => setTemplateModalOpen(false)} className="text-gray-500 hover:text-white text-xl">×</button>
            </div>
            <form onSubmit={handleTemplateSubmit} className="overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
              <div className="flex-1 space-y-4">
                {formError && <div className="rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3 text-sm text-red-400">{formError}</div>}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1.5">Internal Name</label>
                    <input type="text" required value={templateForm.name} onChange={(e) => setTemplateForm(p => ({...p, name: e.target.value}))} className="input w-full" placeholder="e.g. Standard Intro" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1.5">Segment Type</label>
                    <select required value={templateForm.segment_type} onChange={(e) => setTemplateForm(p => ({...p, segment_type: e.target.value as DjSegmentType}))} className="input w-full">
                      {SEGMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Prompt Template</label>
                  <textarea required value={templateForm.prompt_template} onChange={(e) => setTemplateForm(p => ({...p, prompt_template: e.target.value}))} className="input w-full h-64 font-mono text-xs" placeholder="e.g. You are {{dj_name}} on {{station_name}}. Introduce the song {{song_title}} by {{artist}}." />
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t border-[#2a2a40]">
                  <button type="button" onClick={() => setTemplateModalOpen(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" disabled={submitting} className="btn-primary">{submitting ? 'Saving...' : 'Save Template'}</button>
                </div>
              </div>
              
              <div className="w-full md:w-64 space-y-4">
                <h3 className="text-xs font-bold uppercase text-gray-500 tracking-widest">Available Variables</h3>
                <div className="space-y-3">
                  {TEMPLATE_VARIABLES.map(v => (
                    <div key={v.name} className="p-2.5 bg-[#0f0f1a] border border-[#2a2a40] rounded-lg">
                      <code className="text-violet-400 text-xs font-bold">{"{{"}{v.name}{"}}"}</code>
                      <p className="text-[10px] text-gray-500 mt-1">{v.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
