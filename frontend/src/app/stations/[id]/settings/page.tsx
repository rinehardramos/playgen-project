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
      { value: 'mistral', label: 'Mistral Voxtral' },
      { value: 'google', label: 'Google TTS' },
      { value: 'gemini_tts', label: 'Gemini TTS' },
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
    description: 'Voice ID for the selected provider. ElevenLabs: voice ID string. OpenAI: alloy, echo, nova, shimmer. Mistral Voxtral: casual_male, casual_female, cheerful_female, neutral_male, neutral_female, energetic_male, energetic_female, calm_male, calm_female.',
    type: 'text',
    is_secret: false,
    placeholder: 'e.g. energetic_female (Mistral) · alloy (OpenAI) · EXAVITQu4vr4xnSDxMaL (ElevenLabs)',
  },
  {
    key: 'llm_provider',
    label: 'LLM Provider',
    description: 'AI provider used for DJ script generation.',
    type: 'select',
    is_secret: false,
    options: [
      { value: 'openrouter', label: 'OpenRouter (default)' },
      { value: 'anthropic', label: 'Anthropic — Claude (recommended)' },
      { value: 'openai', label: 'OpenAI (direct)' },
      { value: 'gemini', label: 'Google Gemini (direct)' },
    ],
  },
  {
    key: 'llm_model',
    label: 'LLM Model',
    description: 'Model name for the selected provider. Anthropic direct: "claude-sonnet-4-6". OpenRouter: "anthropic/claude-sonnet-4-6". OpenAI direct: "gpt-4o". Gemini: "gemini-2.0-flash".',
    type: 'text',
    is_secret: false,
    placeholder: 'claude-sonnet-4-6',
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
  // Social connections state
  const [socialStatus, setSocialStatus] = useState<SocialStatus | null>(null);
  const [socialToast, setSocialToast] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<Record<string, boolean>>({});

  interface SocialPlatformStatus { connected: boolean; account_name: string | null; connected_at: string | null; }
  interface SocialStatus { facebook: SocialPlatformStatus; twitter: SocialPlatformStatus; }


  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchSettings();
    fetchSocialStatus();
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const socialParam = sp?.get('social'); const statusParam = sp?.get('status');
    if (socialParam && statusParam) {
      const pName = socialParam === 'facebook' ? 'Facebook' : 'X / Twitter';
      setSocialToast(statusParam === 'connected' ? `${pName} connected!` : `Failed to connect ${pName}.`);
      setTimeout(() => setSocialToast(null), 5000);
    }
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


  async function fetchSocialStatus() {
    try {
      const data = await api.get<SocialStatus>(`/api/v1/dj/social/status?station_id=${stationId}`);
      setSocialStatus(data);
    } catch { /* non-critical */ }
  }

  async function disconnectSocial(platform: 'facebook' | 'twitter') {
    setDisconnecting((prev) => ({ ...prev, [platform]: true }));
    try {
      await api.post(`/api/v1/dj/social/${platform}/disconnect`, { station_id: stationId });
      await fetchSocialStatus();
    } catch { /* ignore */ }
    finally { setDisconnecting((prev) => ({ ...prev, [platform]: false })); }
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


      {socialToast && (
        <div className={`mb-4 rounded-md px-4 py-3 border ${socialToast.includes('connected') ? 'bg-green-900/30 border-green-700/50' : 'bg-red-900/30 border-red-700/50'}`}>
          <p className={`text-sm ${socialToast.includes('connected') ? 'text-green-400' : 'text-red-400'}`}>{socialToast}</p>
        </div>
      )}

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


          {/* Social Connections */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-1">Social Connections</h2>
            <p className="text-xs text-gray-500 mb-4">Connect social accounts to auto-pull listener posts into DJ shoutout segments.</p>
            <div className="space-y-4">
              {/* Facebook */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white">Facebook Page</p>
                  {socialStatus?.facebook?.connected
                    ? <p className="text-xs text-green-400">Connected as <span className="font-medium">{socialStatus.facebook.account_name ?? 'Unknown Page'}</span></p>
                    : <p className="text-xs text-gray-500">Not connected</p>}
                </div>
                {socialStatus?.facebook?.connected
                  ? <button onClick={() => disconnectSocial('facebook')} disabled={disconnecting['facebook']} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50">{disconnecting['facebook'] ? 'Disconnecting…' : 'Disconnect'}</button>
                  : <a href={`/api/v1/dj/social/facebook/connect?station_id=${stationId}`} className="btn-primary text-xs px-3 py-1.5">Connect Facebook</a>}
              </div>
              {/* Twitter / X */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">X / Twitter</p>
                    {socialStatus?.twitter?.connected
                      ? <p className="text-xs text-green-400">Connected as <span className="font-medium">{socialStatus.twitter.account_name ?? 'Unknown'}</span></p>
                      : <p className="text-xs text-gray-500">Not connected</p>}
                  </div>
                  {socialStatus?.twitter?.connected
                    ? <button onClick={() => disconnectSocial('twitter')} disabled={disconnecting['twitter']} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50">{disconnecting['twitter'] ? 'Disconnecting…' : 'Disconnect'}</button>
                    : <a href={`/api/v1/dj/social/twitter/connect?station_id=${stationId}`} className="btn-primary text-xs px-3 py-1.5">Connect X / Twitter</a>}
                </div>
                {!socialStatus?.twitter?.connected && (
                  <p className="text-xs text-amber-500/80">Note: X/Twitter Basic tier ($100/mo) recommended for production. <a href="https://developer.twitter.com/en/portal/dashboard" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-400">X Developer Portal</a></p>
                )}
              </div>
            </div>
          </section>

          {/* Music Scanner */}
          <MusicScannerSection stationId={stationId} settings={settings} />

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

// ─── Music Scanner section ──────────────────────────────────────────────────

interface ScanResult {
  status: 'completed' | 'failed';
  started_at: string;
  finished_at: string;
  directory: string;
  recursive: boolean;
  files_found: number;
  imported: number;
  skipped: number;
  errors: number;
  error_message?: string;
}

interface ScanStatusResponse {
  scanning: boolean;
  progress?: { current: number; total: number };
  last_result?: ScanResult;
}

function MusicScannerSection({
  stationId,
  settings,
}: {
  stationId: string;
  settings: Record<string, StationSetting>;
}) {
  const [scanDir, setScanDir] = useState(settings['music_scan_dir']?.value ?? '');
  const [recursive, setRecursive] = useState(settings['music_scan_recursive']?.value !== 'false');
  const [extensions, setExtensions] = useState(settings['music_scan_extensions']?.value ?? 'mp3,flac,wav,m4a,ogg,aac');
  const [autoTranscode, setAutoTranscode] = useState(settings['music_scan_auto_transcode']?.value === 'true');

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState('');
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);

  // Load last scan result on mount
  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  async function fetchStatus() {
    try {
      const data = await api.get<ScanStatusResponse>(`/api/v1/stations/${stationId}/scan-music/status`);
      setScanning(data.scanning);
      setProgress(data.progress ?? null);
      if (data.last_result) setLastResult(data.last_result);
    } catch { /* non-critical */ }
  }

  async function saveScanSetting(key: string, value: string) {
    setSavingField(key);
    try {
      await api.put(`/api/v1/stations/${stationId}/settings/${key}`, { value, is_secret: false });
      setSavedField(key);
      setTimeout(() => setSavedField(null), 2000);
    } catch { /* ignore */ }
    finally { setSavingField(null); }
  }

  async function triggerScan() {
    setScanError('');
    if (!scanDir.trim()) {
      setScanError('Please enter a scan directory path first.');
      return;
    }

    setScanning(true);
    setProgress(null);
    try {
      await api.post(`/api/v1/stations/${stationId}/scan-music`, {
        dir: scanDir.trim(),
        recursive,
        transcode: autoTranscode,
        extensions,
      });

      // Poll status every 2s until done
      const poll = setInterval(async () => {
        try {
          const data = await api.get<ScanStatusResponse>(`/api/v1/stations/${stationId}/scan-music/status`);
          if (data.progress) setProgress(data.progress);
          if (!data.scanning) {
            clearInterval(poll);
            setScanning(false);
            setProgress(null);
            if (data.last_result) setLastResult(data.last_result);
          }
        } catch {
          clearInterval(poll);
          setScanning(false);
        }
      }, 2000);
    } catch (err: unknown) {
      setScanning(false);
      setScanError((err as ApiError).message ?? 'Failed to start scan');
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-1">
        Music Scanner
      </h2>
      <p className="text-xs text-gray-500 mb-4">
        Import audio files from a local directory into this station&apos;s song library.
      </p>

      <div className="space-y-4">
        {/* Scan Directory */}
        <div>
          <label className="block text-sm text-gray-300 mb-0.5 font-medium">Scan Directory</label>
          <p className="text-xs text-gray-500 mb-1.5">Absolute path to the directory containing audio files.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={scanDir}
              onChange={(e) => setScanDir(e.target.value)}
              placeholder="/Users/you/Music"
              className="input flex-1"
            />
            <button
              onClick={() => saveScanSetting('music_scan_dir', scanDir)}
              disabled={savingField === 'music_scan_dir'}
              className="btn-secondary text-xs px-3 py-2 disabled:opacity-40"
            >
              {savingField === 'music_scan_dir' ? '...' : savedField === 'music_scan_dir' ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        {/* Toggles row */}
        <div className="flex flex-wrap gap-6">
          {/* Recursive */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => {
                setRecursive(e.target.checked);
                saveScanSetting('music_scan_recursive', e.target.checked ? 'true' : 'false');
              }}
              className="w-4 h-4 rounded border-gray-600 bg-[#0f0f1a] text-violet-500 focus:ring-violet-500"
            />
            <span className="text-sm text-gray-300">Recursive scan</span>
          </label>

          {/* Auto-transcode */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoTranscode}
              onChange={(e) => {
                setAutoTranscode(e.target.checked);
                saveScanSetting('music_scan_auto_transcode', e.target.checked ? 'true' : 'false');
              }}
              className="w-4 h-4 rounded border-gray-600 bg-[#0f0f1a] text-violet-500 focus:ring-violet-500"
            />
            <span className="text-sm text-gray-300">Auto-transcode to HLS</span>
          </label>
        </div>

        {/* File Extensions */}
        <div>
          <label className="block text-sm text-gray-300 mb-0.5 font-medium">File Extensions</label>
          <p className="text-xs text-gray-500 mb-1.5">Comma-separated list of audio file extensions to include.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={extensions}
              onChange={(e) => setExtensions(e.target.value)}
              placeholder="mp3,flac,wav,m4a,ogg,aac"
              className="input flex-1"
            />
            <button
              onClick={() => saveScanSetting('music_scan_extensions', extensions)}
              disabled={savingField === 'music_scan_extensions'}
              className="btn-secondary text-xs px-3 py-2 disabled:opacity-40"
            >
              {savingField === 'music_scan_extensions' ? '...' : savedField === 'music_scan_extensions' ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        {/* Scan Now button */}
        <div className="pt-1">
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="btn-primary text-sm px-5 py-2.5 disabled:opacity-50"
          >
            {scanning ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {progress ? `Scanning ${progress.current}/${progress.total}...` : 'Starting scan...'}
              </span>
            ) : (
              'Scan Now'
            )}
          </button>
          {scanError && <p className="mt-2 text-xs text-red-400">{scanError}</p>}
        </div>

        {/* Last Scan Result */}
        {lastResult && (
          <div className={`rounded-md px-4 py-3 border text-sm ${
            lastResult.status === 'completed'
              ? 'bg-green-900/20 border-green-700/40'
              : 'bg-red-900/20 border-red-700/40'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className={`font-medium ${lastResult.status === 'completed' ? 'text-green-400' : 'text-red-400'}`}>
                {lastResult.status === 'completed' ? 'Last scan completed' : 'Last scan failed'}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(lastResult.finished_at).toLocaleString()}
              </span>
            </div>
            {lastResult.status === 'completed' ? (
              <p className="text-xs text-gray-400">
                Found {lastResult.files_found} files — {lastResult.imported} imported, {lastResult.skipped} already existed
                {lastResult.errors > 0 && `, ${lastResult.errors} errors`}
              </p>
            ) : (
              <p className="text-xs text-red-400">{lastResult.error_message ?? 'Unknown error'}</p>
            )}
            <p className="text-xs text-gray-500 mt-0.5">{lastResult.directory}{lastResult.recursive ? ' (recursive)' : ''}</p>
          </div>
        )}
      </div>
    </section>
  );
}
