'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface StationSetting {
  id: string;
  station_id: string;
  key: string;
  value: string;
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

interface SettingField {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'password' | 'select';
  is_secret: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

const SETTING_FIELDS: SettingField[] = [
  {
    key: 'tts_provider',
    label: 'TTS Provider',
    description: 'Text-to-speech engine used for AI DJ audio generation.',
    type: 'select',
    is_secret: false,
    options: [
      { value: 'elevenlabs', label: 'ElevenLabs' },
      { value: 'openai', label: 'OpenAI' },
    ],
  },
  {
    key: 'tts_api_key',
    label: 'TTS API Key',
    description: 'API key for the selected TTS provider. Stored encrypted; masked after saving.',
    type: 'password',
    is_secret: true,
    placeholder: 'Paste your TTS provider API key…',
  },
  {
    key: 'tts_voice_id',
    label: 'TTS Voice ID',
    description: 'ElevenLabs voice ID or OpenAI voice name (e.g. alloy, echo, nova).',
    type: 'text',
    is_secret: false,
    placeholder: 'e.g. EXAVITQu4vr4xnSDxMaL',
  },
  {
    key: 'llm_provider',
    label: 'LLM Provider',
    description: 'AI provider used for DJ script generation.',
    type: 'select',
    is_secret: false,
    options: [
      { value: 'openrouter', label: 'OpenRouter (default)' },
      { value: 'anthropic', label: 'Anthropic (direct)' },
      { value: 'openai', label: 'OpenAI (direct)' },
    ],
  },
  {
    key: 'llm_model',
    label: 'LLM Model',
    description: 'Model name for the selected provider. OpenRouter: "anthropic/claude-sonnet-4-5". Anthropic direct: "claude-sonnet-4-5". OpenAI direct: "gpt-4o".',
    type: 'text',
    is_secret: false,
    placeholder: 'anthropic/claude-sonnet-4-5',
  },
  {
    key: 'llm_api_key',
    label: 'LLM API Key',
    description: 'API key for the selected LLM provider. Stored encrypted; masked after saving.',
    type: 'password',
    is_secret: true,
    placeholder: 'sk-or-v1-… / sk-ant-… / sk-…',
  },
];

export default function StationSettingsPage() {
  const params = useParams<{ id: string }>();
  const stationId = params.id;
  const router = useRouter();
  const currentUser = getCurrentUser();

  const [settings, setSettings] = useState<Record<string, StationSetting>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  async function fetchSettings() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<StationSetting[]>(`/api/v1/stations/${stationId}/settings`);
      const map: Record<string, StationSetting> = {};
      for (const s of data) map[s.key] = s;
      setSettings(map);
      // Seed draft values from current settings (show *** for secrets)
      const d: Record<string, string> = {};
      for (const field of SETTING_FIELDS) {
        d[field.key] = map[field.key]?.value ?? '';
      }
      setDrafts(d);
    } catch (err: unknown) {
      setLoadError((err as ApiError).message ?? 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  function setDraft(key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    // Clear previous save feedback when editing
    setErrors((prev) => ({ ...prev, [key]: '' }));
    setSuccess((prev) => ({ ...prev, [key]: false }));
  }

  async function saveSetting(field: SettingField) {
    const value = drafts[field.key] ?? '';
    // Don't save if it's still a masked placeholder (user hasn't typed a new value)
    if (value === '***') return;
    if (value.trim() === '' && settings[field.key]) {
      // Empty value = delete the setting
      await deleteSetting(field);
      return;
    }
    if (value.trim() === '') return;

    setSaving((prev) => ({ ...prev, [field.key]: true }));
    setErrors((prev) => ({ ...prev, [field.key]: '' }));
    try {
      const updated = await api.put<StationSetting>(
        `/api/v1/stations/${stationId}/settings/${field.key}`,
        { value, is_secret: field.is_secret },
      );
      setSettings((prev) => ({ ...prev, [field.key]: updated }));
      // Reset draft to the (potentially masked) saved value
      setDrafts((prev) => ({ ...prev, [field.key]: updated.value }));
      setSuccess((prev) => ({ ...prev, [field.key]: true }));
      setTimeout(() => setSuccess((prev) => ({ ...prev, [field.key]: false })), 2500);
    } catch (err: unknown) {
      setErrors((prev) => ({
        ...prev,
        [field.key]: (err as ApiError).message ?? 'Failed to save',
      }));
    } finally {
      setSaving((prev) => ({ ...prev, [field.key]: false }));
    }
  }

  async function deleteSetting(field: SettingField) {
    setSaving((prev) => ({ ...prev, [field.key]: true }));
    try {
      await api.delete(`/api/v1/stations/${stationId}/settings/${field.key}`);
      setSettings((prev) => {
        const next = { ...prev };
        delete next[field.key];
        return next;
      });
      setDrafts((prev) => ({ ...prev, [field.key]: '' }));
      setSuccess((prev) => ({ ...prev, [field.key]: true }));
      setTimeout(() => setSuccess((prev) => ({ ...prev, [field.key]: false })), 2500);
    } catch (err: unknown) {
      setErrors((prev) => ({
        ...prev,
        [field.key]: (err as ApiError).message ?? 'Failed to delete',
      }));
    } finally {
      setSaving((prev) => ({ ...prev, [field.key]: false }));
    }
  }

  function toggleReveal(key: string) {
    setRevealed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (!currentUser) return null;

  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="text-gray-500 hover:text-gray-300 text-sm"
        >
          ← Back
        </button>
        <h1 className="text-xl font-bold text-white">Station Settings</h1>
      </div>

      {loadError && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{loadError}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* TTS Group */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-4">
              Text-to-Speech
            </h2>
            <div className="space-y-4">
              {SETTING_FIELDS.filter((f) =>
                ['tts_provider', 'tts_api_key', 'tts_voice_id'].includes(f.key),
              ).map((field) => (
                <SettingRow
                  key={field.key}
                  field={field}
                  value={drafts[field.key] ?? ''}
                  isSaved={!!settings[field.key]}
                  saving={saving[field.key] ?? false}
                  error={errors[field.key] ?? ''}
                  showSuccess={success[field.key] ?? false}
                  revealed={revealed[field.key] ?? false}
                  onChange={(v) => setDraft(field.key, v)}
                  onSave={() => saveSetting(field)}
                  onClear={() => deleteSetting(field)}
                  onToggleReveal={() => toggleReveal(field.key)}
                />
              ))}
            </div>
          </section>

          {/* LLM Group */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-4">
              LLM / Script Generation
            </h2>
            <div className="space-y-4">
              {SETTING_FIELDS.filter((f) =>
                ['llm_provider', 'llm_model', 'llm_api_key'].includes(f.key),
              ).map((field) => (
                <SettingRow
                  key={field.key}
                  field={field}
                  value={drafts[field.key] ?? ''}
                  isSaved={!!settings[field.key]}
                  saving={saving[field.key] ?? false}
                  error={errors[field.key] ?? ''}
                  showSuccess={success[field.key] ?? false}
                  revealed={revealed[field.key] ?? false}
                  onChange={(v) => setDraft(field.key, v)}
                  onSave={() => saveSetting(field)}
                  onClear={() => deleteSetting(field)}
                  onToggleReveal={() => toggleReveal(field.key)}
                />
              ))}
            </div>
          </section>

          <p className="text-xs text-gray-600 px-1">
            Settings override service-level environment variables. Leave a field empty to use the
            service default. Secret values (API keys) are masked after saving.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── SettingRow component ─────────────────────────────────────────────────────

interface SettingRowProps {
  field: SettingField;
  value: string;
  isSaved: boolean;
  saving: boolean;
  error: string;
  showSuccess: boolean;
  revealed: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onClear: () => void;
  onToggleReveal: () => void;
}

function SettingRow({
  field,
  value,
  isSaved,
  saving,
  error,
  showSuccess,
  revealed,
  onChange,
  onSave,
  onClear,
  onToggleReveal,
}: SettingRowProps) {
  const isSecret = field.is_secret;
  const masked = isSecret && value === '***';

  return (
    <div>
      <label className="block text-sm text-gray-300 mb-0.5 font-medium">{field.label}</label>
      <p className="text-xs text-gray-500 mb-1.5">{field.description}</p>

      <div className="flex gap-2 items-center">
        {field.type === 'select' ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input flex-1"
          >
            <option value="">— use service default —</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="relative flex-1">
            <input
              type={isSecret && !revealed ? 'password' : 'text'}
              value={masked ? '' : value}
              placeholder={masked ? '(saved — enter new value to replace)' : field.placeholder}
              onChange={(e) => onChange(e.target.value)}
              className="input w-full pr-16"
            />
            {isSecret && (
              <button
                type="button"
                onClick={onToggleReveal}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
                tabIndex={-1}
              >
                {revealed ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onSave}
          disabled={saving || masked}
          className="btn-primary text-xs px-3 py-2 disabled:opacity-40"
        >
          {saving ? '…' : 'Save'}
        </button>

        {isSaved && (
          <button
            type="button"
            onClick={onClear}
            disabled={saving}
            className="btn-secondary text-xs px-3 py-2 disabled:opacity-40"
            title="Remove this setting (revert to service default)"
          >
            Clear
          </button>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {showSuccess && <p className="mt-1 text-xs text-green-400">Saved.</p>}
    </div>
  );
}
