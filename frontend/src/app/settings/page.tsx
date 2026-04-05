'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface Station {
  id: string;
  name: string;
}

interface StationConfig {
  timezone: string;
  broadcast_start_hour: number;
  broadcast_end_hour: number;
  active_days: string[];
  openai_api_key?: string;
  elevenlabs_api_key?: string;
  openrouter_api_key?: string;
  anthropic_api_key?: string;
  gemini_api_key?: string;
  mistral_api_key?: string;
}

interface RotationRules {
  max_plays_per_day: number;
  min_gap_hours: number;
  max_same_artist_per_hour: number;
  artist_separation_slots: number;
}

interface DjSettings {
  llm_provider: string;
  llm_model: string;
  tts_provider: string;
  tts_voice_id: string;
}

const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const DEFAULT_CONFIG: StationConfig = {
  timezone: 'Asia/Manila',
  broadcast_start_hour: 4,
  broadcast_end_hour: 3,
  active_days: [...ALL_DAYS],
  openai_api_key: '',
  elevenlabs_api_key: '',
  openrouter_api_key: '',
  anthropic_api_key: '',
  gemini_api_key: '',
  mistral_api_key: '',
};

const DEFAULT_RULES: RotationRules = {
  max_plays_per_day: 2,
  min_gap_hours: 2,
  max_same_artist_per_hour: 1,
  artist_separation_slots: 3,
};

const DEFAULT_DJ: DjSettings = {
  llm_provider: 'openrouter',
  llm_model: '',
  tts_provider: 'openai',
  tts_voice_id: '',
};

export default function SettingsPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const companyId = currentUser?.company_id ?? '';

  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('');

  // Station config state
  const [config, setConfig] = useState<StationConfig>(DEFAULT_CONFIG);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState(false);

  // Rotation rules state
  const [rules, setRules] = useState<RotationRules>(DEFAULT_RULES);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesSuccess, setRulesSuccess] = useState(false);

  // AI DJ settings state (from station_settings table)
  const [dj, setDj] = useState<DjSettings>(DEFAULT_DJ);
  const [djLoading, setDjLoading] = useState(false);
  const [djSaving, setDjSaving] = useState(false);
  const [djError, setDjError] = useState<string | null>(null);
  const [djSuccess, setDjSuccess] = useState(false);

  const [fetchError, setFetchError] = useState<string | null>(null);

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
      fetchConfig(selectedStation);
      fetchRules(selectedStation);
      fetchDjSettings(selectedStation);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation]);

  async function fetchStations() {
    try {
      const data = await api.get<Station[]>(`/api/v1/companies/${companyId}/stations`);
      setStations(data);
      if (data.length > 0) setSelectedStation(data[0].id);
    } catch (err: unknown) {
      setFetchError((err as ApiError).message ?? 'Failed to load stations');
    }
  }

  async function fetchConfig(stationId: string) {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const data = await api.get<StationConfig>(`/api/v1/stations/${stationId}/config`);
      setConfig(data);
    } catch {
      setConfig(DEFAULT_CONFIG);
    } finally {
      setConfigLoading(false);
    }
  }

  async function fetchRules(stationId: string) {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const result = await api.get<{ rules: RotationRules }>(
        `/api/v1/stations/${stationId}/rotation-rules`
      );
      setRules(result.rules ?? DEFAULT_RULES);
    } catch {
      setRules(DEFAULT_RULES);
    } finally {
      setRulesLoading(false);
    }
  }

  async function fetchDjSettings(stationId: string) {
    setDjLoading(true);
    try {
      const data = await api.get<Array<{ key: string; value: string }>>(
        `/api/v1/stations/${stationId}/settings`,
      );
      const map = Object.fromEntries(data.map((s) => [s.key, s.value]));
      setDj({
        llm_provider: map['llm_provider'] ?? DEFAULT_DJ.llm_provider,
        llm_model:    map['llm_model']    ?? DEFAULT_DJ.llm_model,
        tts_provider: map['tts_provider'] ?? DEFAULT_DJ.tts_provider,
        tts_voice_id: map['tts_voice_id'] ?? DEFAULT_DJ.tts_voice_id,
      });
    } catch {
      setDj(DEFAULT_DJ);
    } finally {
      setDjLoading(false);
    }
  }

  async function handleConfigSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setConfigError(null);
    setConfigSuccess(false);
    setConfigSaving(true);
    try {
      const updated = await api.put<StationConfig>(
        `/api/v1/stations/${selectedStation}/config`,
        config,
      );
      setConfig(updated);
      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), 3000);
    } catch (err: unknown) {
      setConfigError((err as ApiError).message ?? 'Failed to save station config');
    } finally {
      setConfigSaving(false);
    }
  }

  async function handleRulesSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRulesError(null);
    setRulesSuccess(false);
    setRulesSaving(true);
    try {
      await api.put<{ rules: RotationRules }>(
        `/api/v1/stations/${selectedStation}/rotation-rules`,
        { rules }
      );
      setRulesSuccess(true);
      setTimeout(() => setRulesSuccess(false), 3000);
    } catch (err: unknown) {
      setRulesError((err as ApiError).message ?? 'Failed to save rotation rules');
    } finally {
      setRulesSaving(false);
    }
  }

  async function handleDjSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDjError(null);
    setDjSuccess(false);
    setDjSaving(true);
    try {
      // Save each DJ setting key individually to station_settings
      const settingsToSave: Array<{ key: keyof DjSettings; is_secret: boolean }> = [
        { key: 'llm_provider', is_secret: false },
        { key: 'llm_model',    is_secret: false },
        { key: 'tts_provider', is_secret: false },
        { key: 'tts_voice_id', is_secret: false },
      ];
      await Promise.all(
        settingsToSave.map(({ key, is_secret }) =>
          api.put(`/api/v1/stations/${selectedStation}/settings/${key}`, {
            value: dj[key],
            is_secret,
          }),
        ),
      );
      setDjSuccess(true);
      setTimeout(() => setDjSuccess(false), 3000);
    } catch (err: unknown) {
      setDjError((err as ApiError).message ?? 'Failed to save DJ settings');
    } finally {
      setDjSaving(false);
    }
  }

  function setRule<K extends keyof RotationRules>(key: K, value: number) {
    setRules((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDay(day: string) {
    setConfig((prev) => ({
      ...prev,
      active_days: prev.active_days.includes(day)
        ? prev.active_days.filter((d) => d !== day)
        : [...prev.active_days, day],
    }));
  }

  const ruleFields: { key: keyof RotationRules; label: string; description: string }[] = [
    {
      key: 'max_plays_per_day',
      label: 'Max Plays Per Day',
      description: 'Maximum number of times a single song can be played in a day',
    },
    {
      key: 'min_gap_hours',
      label: 'Min Gap Hours',
      description: 'Minimum hours between consecutive plays of the same song',
    },
    {
      key: 'max_same_artist_per_hour',
      label: 'Max Same Artist Per Hour',
      description: 'Maximum songs by the same artist allowed in a single hour',
    },
    {
      key: 'artist_separation_slots',
      label: 'Artist Separation Slots',
      description: 'Minimum number of slots between songs from the same artist',
    },
  ];

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Configure your station settings and rotation rules</p>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{fetchError}</p>
        </div>
      )}

      {/* Station selector */}
      {stations.length > 1 && (
        <div className="mb-6 max-w-xs">
          <label className="block text-sm text-gray-400 mb-1.5">Station</label>
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="input w-full"
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!selectedStation ? (
        <div className="py-16 text-center text-gray-600 text-sm">
          No stations available. Add a station first.
        </div>
      ) : (
        <div className="space-y-8 max-w-lg">

          {/* ── Station Config ──────────────────────────────────────────────── */}
          {configLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <form onSubmit={handleConfigSave}>
              <div className="card p-6 space-y-5">
                <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
                  Station Config
                </h2>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-0.5">Timezone</label>
                  <p className="text-xs text-gray-500 mb-2">IANA timezone used for scheduling (e.g. Asia/Manila)</p>
                  <input
                    type="text"
                    required
                    value={config.timezone}
                    onChange={(e) => setConfig((p) => ({ ...p, timezone: e.target.value }))}
                    className="input w-full"
                    placeholder="Asia/Manila"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">Broadcast Start Hour</label>
                    <p className="text-xs text-gray-500 mb-2">Hour (0–23) the broadcast day begins</p>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      required
                      value={config.broadcast_start_hour}
                      onChange={(e) => setConfig((p) => ({ ...p, broadcast_start_hour: Number(e.target.value) }))}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">Broadcast End Hour</label>
                    <p className="text-xs text-gray-500 mb-2">Hour (0–23) the broadcast day ends</p>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      required
                      value={config.broadcast_end_hour}
                      onChange={(e) => setConfig((p) => ({ ...p, broadcast_end_hour: Number(e.target.value) }))}
                      className="input w-full"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Active Days</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_DAYS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                          config.active_days.includes(day)
                            ? 'bg-violet-600 text-white'
                            : 'bg-[#24243a] text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>

                {/* API Keys */}
                <div className="pt-4 border-t border-gray-800 space-y-5">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    API Keys
                  </h3>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">OpenRouter API Key</label>
                    <p className="text-xs text-gray-500 mb-2">Used when LLM Provider is set to OpenRouter</p>
                    <input
                      type="password"
                      value={config.openrouter_api_key || ''}
                      onChange={(e) => setConfig((p) => ({ ...p, openrouter_api_key: e.target.value }))}
                      className="input w-full"
                      placeholder="sk-or-v1-..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">Anthropic API Key</label>
                    <p className="text-xs text-gray-500 mb-2">Used when LLM Provider is set to Anthropic</p>
                    <input
                      type="password"
                      value={config.anthropic_api_key || ''}
                      onChange={(e) => setConfig((p) => ({ ...p, anthropic_api_key: e.target.value }))}
                      className="input w-full"
                      placeholder="sk-ant-..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">OpenAI API Key</label>
                    <p className="text-xs text-gray-500 mb-2">Used for OpenAI TTS or when LLM Provider is set to OpenAI</p>
                    <input
                      type="password"
                      value={config.openai_api_key || ''}
                      onChange={(e) => setConfig((p) => ({ ...p, openai_api_key: e.target.value }))}
                      className="input w-full"
                      placeholder="sk-..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">ElevenLabs API Key</label>
                    <p className="text-xs text-gray-500 mb-2">Used when TTS Provider is set to ElevenLabs</p>
                    <input
                      type="password"
                      value={config.elevenlabs_api_key || ''}
                      onChange={(e) => setConfig((p) => ({ ...p, elevenlabs_api_key: e.target.value }))}
                      className="input w-full"
                      placeholder="eleven-..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">Gemini API Key</label>
                    <p className="text-xs text-gray-500 mb-2">Used for Gemini LLM, Google TTS, and Gemini native TTS (Google AI Studio)</p>
                    <input
                      type="password"
                      value={config.gemini_api_key || ''}
                      onChange={(e) => setConfig((p) => ({ ...p, gemini_api_key: e.target.value }))}
                      className="input w-full"
                      placeholder="AIza..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">Mistral API Key</label>
                    <p className="text-xs text-gray-500 mb-2">Used for Mistral LLM and Voxtral TTS (La Plateforme)</p>
                    <input
                      type="password"
                      value={config.mistral_api_key || ''}
                      onChange={(e) => setConfig((p) => ({ ...p, mistral_api_key: e.target.value }))}
                      className="input w-full"
                      placeholder="..."
                    />
                  </div>
                </div>
              </div>

              {configError && (
                <div className="mt-3 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                  <p className="text-sm text-red-400">{configError}</p>
                </div>
              )}
              {configSuccess && (
                <div className="mt-3 rounded-md bg-green-900/30 border border-green-700/50 px-4 py-3">
                  <p className="text-sm text-green-400">Station config saved.</p>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button type="submit" disabled={configSaving} className="btn-primary disabled:opacity-50">
                  {configSaving ? 'Saving…' : 'Save Config'}
                </button>
              </div>
            </form>
          )}

          {/* ── DJ Settings ──────────────────────────────────────────────── */}
          {djLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <form onSubmit={handleDjSave}>
              <div className="card p-6 space-y-5">
                <div>
                  <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
                    DJ Settings
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Configure the LLM and TTS providers for DJ script generation.
                  </p>
                </div>

                {/* Script Generation */}
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Script Generation (LLM)
                  </h3>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">LLM Provider</label>
                    <p className="text-xs text-gray-500 mb-2">
                      AI provider for generating DJ scripts. Make sure the matching API key is set above.
                    </p>
                    <select
                      value={dj.llm_provider}
                      onChange={(e) => setDj((p) => ({ ...p, llm_provider: e.target.value }))}
                      className="input w-full"
                    >
                      <option value="openrouter">OpenRouter (routes to any model via OpenRouter key)</option>
                      <option value="anthropic">Anthropic (direct — uses Anthropic API Key)</option>
                      <option value="openai">OpenAI (direct — uses OpenAI API Key)</option>
                      <option value="gemini">Gemini (direct — uses Gemini API Key)</option>
                      <option value="mistral">Mistral (direct — uses Mistral API Key)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">LLM Model</label>
                    <p className="text-xs text-gray-500 mb-2">
                      {dj.llm_provider === 'openrouter'
                        ? 'OpenRouter model ID, e.g. anthropic/claude-sonnet-4-5 or openai/gpt-4o'
                        : dj.llm_provider === 'anthropic'
                        ? 'Anthropic model ID, e.g. claude-sonnet-4-5 or claude-3-5-haiku-20241022'
                        : dj.llm_provider === 'gemini'
                        ? 'Gemini model ID, e.g. gemini-2.0-flash or gemini-1.5-flash'
                        : dj.llm_provider === 'mistral'
                        ? 'Mistral model ID, e.g. mistral-large-latest or mistral-small-latest'
                        : 'OpenAI model ID, e.g. gpt-4o or gpt-4o-mini'}
                    </p>
                    <input
                      type="text"
                      value={dj.llm_model}
                      onChange={(e) => setDj((p) => ({ ...p, llm_model: e.target.value }))}
                      className="input w-full"
                      placeholder={
                        dj.llm_provider === 'openrouter'
                          ? 'anthropic/claude-sonnet-4-5'
                          : dj.llm_provider === 'anthropic'
                          ? 'claude-sonnet-4-5'
                          : dj.llm_provider === 'gemini'
                          ? 'gemini-2.0-flash'
                          : dj.llm_provider === 'mistral'
                          ? 'mistral-large-latest'
                          : 'gpt-4o'
                      }
                    />
                  </div>
                </div>

                {/* Text-to-Speech */}
                <div className="pt-4 border-t border-gray-800 space-y-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Text-to-Speech (TTS)
                  </h3>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">TTS Provider</label>
                    <p className="text-xs text-gray-500 mb-2">
                      Audio synthesis provider. Make sure the matching API key is set above.
                    </p>
                    <select
                      value={dj.tts_provider}
                      onChange={(e) => setDj((p) => ({ ...p, tts_provider: e.target.value }))}
                      className="input w-full"
                    >
                      <option value="openai">OpenAI (uses OpenAI API Key)</option>
                      <option value="elevenlabs">ElevenLabs (uses ElevenLabs API Key)</option>
                      <option value="google">Google TTS (uses Gemini API Key)</option>
                      <option value="gemini_tts">Gemini Native TTS (uses Gemini API Key — higher quality)</option>
                      <option value="mistral">Mistral Voxtral (uses Mistral API Key)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">TTS Voice ID</label>
                    <p className="text-xs text-gray-500 mb-2">
                      {dj.tts_provider === 'elevenlabs'
                        ? 'ElevenLabs voice ID (e.g. EXAVITQu4vr4xnSDxMaL)'
                        : dj.tts_provider === 'google'
                        ? 'Google voice name, e.g. en-US-Neural2-D (Male), en-US-Neural2-F (Female), en-GB-Neural2-B (UK Male)'
                        : dj.tts_provider === 'gemini_tts'
                        ? 'Gemini voice name, e.g. Kore (firm), Aoede (breezy), Fenrir (excitable), Puck (upbeat), Zephyr (bright), Charon (informational)'
                        : dj.tts_provider === 'mistral'
                        ? 'Mistral preset voice: casual_male, casual_female, cheerful_female, neutral_male, neutral_female, energetic_male, calm_female'
                        : 'OpenAI voice name: alloy, echo, fable, nova, onyx, shimmer'}
                    </p>
                    <input
                      type="text"
                      value={dj.tts_voice_id}
                      onChange={(e) => setDj((p) => ({ ...p, tts_voice_id: e.target.value }))}
                      className="input w-full"
                      placeholder={
                        dj.tts_provider === 'elevenlabs'
                          ? 'EXAVITQu4vr4xnSDxMaL'
                          : dj.tts_provider === 'google'
                          ? 'en-US-Neural2-D'
                          : dj.tts_provider === 'gemini_tts'
                          ? 'Kore'
                          : dj.tts_provider === 'mistral'
                          ? 'neutral_male'
                          : 'alloy'
                      }
                    />
                  </div>
                </div>
              </div>

              {djError && (
                <div className="mt-3 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                  <p className="text-sm text-red-400">{djError}</p>
                </div>
              )}
              {djSuccess && (
                <div className="mt-3 rounded-md bg-green-900/30 border border-green-700/50 px-4 py-3">
                  <p className="text-sm text-green-400">AI DJ settings saved.</p>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button type="submit" disabled={djSaving} className="btn-primary disabled:opacity-50">
                  {djSaving ? 'Saving…' : 'Save DJ Settings'}
                </button>
              </div>
            </form>
          )}

          {/* ── Rotation Rules ──────────────────────────────────────────────── */}
          {rulesLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <form onSubmit={handleRulesSave}>
              <div className="card p-6 space-y-6">
                <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
                  Rotation Rules
                </h2>

                {ruleFields.map(({ key, label, description }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-300 mb-0.5">{label}</label>
                    <p className="text-xs text-gray-500 mb-2">{description}</p>
                    <input
                      type="number"
                      min={0}
                      required
                      value={rules[key]}
                      onChange={(e) => setRule(key, Number(e.target.value))}
                      className="input w-full"
                    />
                  </div>
                ))}
              </div>

              {rulesError && (
                <div className="mt-3 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
                  <p className="text-sm text-red-400">{rulesError}</p>
                </div>
              )}
              {rulesSuccess && (
                <div className="mt-3 rounded-md bg-green-900/30 border border-green-700/50 px-4 py-3">
                  <p className="text-sm text-green-400">Rotation rules saved.</p>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button type="submit" disabled={rulesSaving} className="btn-primary disabled:opacity-50">
                  {rulesSaving ? 'Saving…' : 'Save Rules'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
