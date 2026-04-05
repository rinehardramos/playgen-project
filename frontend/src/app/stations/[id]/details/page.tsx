'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

type BroadcastType = 'fm' | 'am' | 'online' | 'podcast' | 'dab';

interface StationDetails {
  id: string;
  company_id: string;
  name: string;
  timezone: string;
  // Identity
  callsign: string | null;
  tagline: string | null;
  frequency: string | null;
  broadcast_type: BroadcastType | null;
  // Locale
  city: string | null;
  province: string | null;
  country: string | null;
  locale_code: string | null;
  latitude: number | null;
  longitude: number | null;
  // Social media
  facebook_page_url: string | null;
  twitter_handle: string | null;
  instagram_handle: string | null;
  youtube_channel_url: string | null;
  // Branding
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  website_url: string | null;
}

interface FormState {
  // Identity
  callsign: string;
  tagline: string;
  frequency: string;
  broadcast_type: BroadcastType;
  // Locale
  city: string;
  province: string;
  country: string;
  timezone: string;
  locale_code: string;
  latitude: string;
  longitude: string;
  // Social media
  facebook_page_url: string;
  twitter_handle: string;
  instagram_handle: string;
  youtube_channel_url: string;
  // Branding
  logo_url: string;
  website_url: string;
  primary_color: string;
  secondary_color: string;
}

const EMPTY_FORM: FormState = {
  callsign: '',
  tagline: '',
  frequency: '',
  broadcast_type: 'fm',
  city: '',
  province: '',
  country: '',
  timezone: '',
  locale_code: '',
  latitude: '',
  longitude: '',
  facebook_page_url: '',
  twitter_handle: '',
  instagram_handle: '',
  youtube_channel_url: '',
  logo_url: '',
  website_url: '',
  primary_color: '#7c3aed',
  secondary_color: '#a78bfa',
};

const BROADCAST_TYPE_OPTIONS: Array<{ value: BroadcastType; label: string }> = [
  { value: 'fm', label: 'FM' },
  { value: 'am', label: 'AM' },
  { value: 'online', label: 'Online / Streaming' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'dab', label: 'DAB / Digital' },
];

function stationToForm(station: StationDetails): FormState {
  return {
    callsign: station.callsign ?? '',
    tagline: station.tagline ?? '',
    frequency: station.frequency ?? '',
    broadcast_type: station.broadcast_type ?? 'fm',
    city: station.city ?? '',
    province: station.province ?? '',
    country: station.country ?? '',
    timezone: station.timezone ?? '',
    locale_code: station.locale_code ?? '',
    latitude: station.latitude != null ? String(station.latitude) : '',
    longitude: station.longitude != null ? String(station.longitude) : '',
    facebook_page_url: station.facebook_page_url ?? '',
    twitter_handle: station.twitter_handle ?? '',
    instagram_handle: station.instagram_handle ?? '',
    youtube_channel_url: station.youtube_channel_url ?? '',
    logo_url: station.logo_url ?? '',
    website_url: station.website_url ?? '',
    primary_color: station.primary_color ?? '#7c3aed',
    secondary_color: station.secondary_color ?? '#a78bfa',
  };
}

function formToPayload(form: FormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    callsign: form.callsign || null,
    tagline: form.tagline || null,
    frequency: form.frequency || null,
    broadcast_type: form.broadcast_type || null,
    city: form.city || null,
    province: form.province || null,
    country: form.country || null,
    timezone: form.timezone || null,
    locale_code: form.locale_code || null,
    latitude: form.latitude !== '' ? parseFloat(form.latitude) : null,
    longitude: form.longitude !== '' ? parseFloat(form.longitude) : null,
    facebook_page_url: form.facebook_page_url || null,
    twitter_handle: form.twitter_handle || null,
    instagram_handle: form.instagram_handle || null,
    youtube_channel_url: form.youtube_channel_url || null,
    logo_url: form.logo_url || null,
    website_url: form.website_url || null,
    primary_color: /^#[0-9A-Fa-f]{6}$/.test(form.primary_color) ? form.primary_color : null,
    secondary_color: /^#[0-9A-Fa-f]{6}$/.test(form.secondary_color) ? form.secondary_color : null,
  };
  // Remove keys where timezone is empty (don't overwrite with null if not changed)
  if (payload.timezone === null) delete payload.timezone;
  return payload;
}

export default function StationDetailsPage() {
  const params = useParams<{ id: string }>();
  const stationId = params.id;
  const router = useRouter();
  const currentUser = getCurrentUser();

  const [station, setStation] = useState<StationDetails | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchStation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  async function fetchStation() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<StationDetails>(`/api/v1/stations/${stationId}`);
      setStation(data);
      setForm(stationToForm(data));
    } catch (err: unknown) {
      setLoadError((err as ApiError).message ?? 'Failed to load station');
    } finally {
      setLoading(false);
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveError(null);
    setSaveSuccess(false);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updated = await api.put<StationDetails>(
        `/api/v1/stations/${stationId}`,
        formToPayload(form),
      );
      setStation(updated);
      setForm(stationToForm(updated));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setSaveError((err as ApiError).message ?? 'Failed to save station details');
    } finally {
      setSaving(false);
    }
  }

  if (!currentUser) return null;

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="text-gray-500 hover:text-gray-300 text-sm"
        >
          ← Back
        </button>
        <h1 className="text-xl font-bold text-white">Station Details</h1>
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
        <>
          {/* Preview card */}
          {station && (
            <div
              className="mb-6 rounded-xl border border-[#2a2a40] p-5 flex items-start gap-4"
              style={{ background: form.primary_color ? `${form.primary_color}18` : undefined }}
            >
              {form.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.logo_url}
                  alt="Station logo"
                  className="w-14 h-14 rounded-lg object-contain bg-[#16161f] border border-[#2a2a40]"
                />
              ) : (
                <div
                  className="w-14 h-14 rounded-lg flex items-center justify-center text-white font-bold text-lg shrink-0"
                  style={{ background: form.primary_color ?? '#7c3aed' }}
                >
                  {form.callsign ? form.callsign.slice(0, 2).toUpperCase() : station.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-semibold text-base">
                    {form.callsign || station.name}
                  </span>
                  {form.frequency && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-violet-900/40 text-violet-300 border border-violet-700/40">
                      {form.frequency} {form.broadcast_type?.toUpperCase()}
                    </span>
                  )}
                </div>
                {form.tagline && (
                  <p className="text-sm text-gray-400 mt-0.5 truncate">{form.tagline}</p>
                )}
                {(form.city || form.country) && (
                  <p className="text-xs text-gray-500 mt-1">
                    {[form.city, form.country].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Identity */}
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-4">
                Identity
              </h2>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    label="Callsign"
                    description="Station call letters (e.g. DWRR)"
                  >
                    <input
                      type="text"
                      value={form.callsign}
                      onChange={(e) => setField('callsign', e.target.value)}
                      maxLength={10}
                      placeholder="e.g. DWRR"
                      className="input w-full"
                    />
                  </FormField>
                  <FormField
                    label="Frequency"
                    description="Broadcast frequency (e.g. 97.9)"
                  >
                    <input
                      type="text"
                      value={form.frequency}
                      onChange={(e) => setField('frequency', e.target.value)}
                      maxLength={20}
                      placeholder="e.g. 97.9"
                      className="input w-full"
                    />
                  </FormField>
                </div>
                <FormField
                  label="Tagline"
                  description="Short slogan or description for the station"
                >
                  <input
                    type="text"
                    value={form.tagline}
                    onChange={(e) => setField('tagline', e.target.value)}
                    maxLength={255}
                    placeholder="e.g. Manila's #1 Hit Music Station"
                    className="input w-full"
                  />
                </FormField>
                <FormField
                  label="Broadcast Type"
                  description="Medium through which this station broadcasts"
                >
                  <select
                    value={form.broadcast_type}
                    onChange={(e) => setField('broadcast_type', e.target.value as BroadcastType)}
                    className="input w-full"
                  >
                    {BROADCAST_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            </section>

            {/* Locale */}
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-4">
                Locale
              </h2>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="City">
                    <input
                      type="text"
                      value={form.city}
                      onChange={(e) => setField('city', e.target.value)}
                      maxLength={100}
                      placeholder="e.g. Manila"
                      className="input w-full"
                    />
                  </FormField>
                  <FormField label="Province / State">
                    <input
                      type="text"
                      value={form.province}
                      onChange={(e) => setField('province', e.target.value)}
                      maxLength={100}
                      placeholder="e.g. Metro Manila"
                      className="input w-full"
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Country">
                    <input
                      type="text"
                      value={form.country}
                      onChange={(e) => setField('country', e.target.value)}
                      maxLength={100}
                      placeholder="e.g. Philippines"
                      className="input w-full"
                    />
                  </FormField>
                  <FormField
                    label="Timezone"
                    description="IANA timezone identifier"
                  >
                    <input
                      type="text"
                      value={form.timezone}
                      onChange={(e) => setField('timezone', e.target.value)}
                      maxLength={100}
                      placeholder="Asia/Manila"
                      className="input w-full"
                    />
                  </FormField>
                </div>
                <FormField
                  label="Locale Code"
                  description="BCP 47 locale tag (e.g. en-PH)"
                >
                  <input
                    type="text"
                    value={form.locale_code}
                    onChange={(e) => setField('locale_code', e.target.value)}
                    maxLength={20}
                    placeholder="e.g. en-PH"
                    className="input w-full"
                  />
                </FormField>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    label="Latitude"
                    description="Decimal degrees, -90 to 90"
                  >
                    <input
                      type="number"
                      value={form.latitude}
                      onChange={(e) => setField('latitude', e.target.value)}
                      step="0.000001"
                      min={-90}
                      max={90}
                      placeholder="e.g. 14.5995"
                      className="input w-full"
                    />
                  </FormField>
                  <FormField
                    label="Longitude"
                    description="Decimal degrees, -180 to 180"
                  >
                    <input
                      type="number"
                      value={form.longitude}
                      onChange={(e) => setField('longitude', e.target.value)}
                      step="0.000001"
                      min={-180}
                      max={180}
                      placeholder="e.g. 120.9842"
                      className="input w-full"
                    />
                  </FormField>
                </div>
              </div>
            </section>

            {/* Social Media */}
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-4">
                Social Media
              </h2>
              <div className="space-y-4">
                <FormField label="Facebook Page URL">
                  <input
                    type="text"
                    value={form.facebook_page_url}
                    onChange={(e) => setField('facebook_page_url', e.target.value)}
                    maxLength={255}
                    placeholder="https://facebook.com/yourstation"
                    className="input w-full"
                  />
                </FormField>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Twitter / X Handle">
                    <div className="flex items-center">
                      <span className="px-3 py-2 bg-[#13131a] border border-r-0 border-[#2a2a40] rounded-l-md text-gray-500 text-sm">@</span>
                      <input
                        type="text"
                        value={form.twitter_handle}
                        onChange={(e) => setField('twitter_handle', e.target.value.replace(/^@/, ''))}
                        maxLength={100}
                        placeholder="yourstation"
                        className="input w-full rounded-l-none"
                      />
                    </div>
                  </FormField>
                  <FormField label="Instagram Handle">
                    <div className="flex items-center">
                      <span className="px-3 py-2 bg-[#13131a] border border-r-0 border-[#2a2a40] rounded-l-md text-gray-500 text-sm">@</span>
                      <input
                        type="text"
                        value={form.instagram_handle}
                        onChange={(e) => setField('instagram_handle', e.target.value.replace(/^@/, ''))}
                        maxLength={100}
                        placeholder="yourstation"
                        className="input w-full rounded-l-none"
                      />
                    </div>
                  </FormField>
                </div>
                <FormField label="YouTube Channel URL">
                  <input
                    type="text"
                    value={form.youtube_channel_url}
                    onChange={(e) => setField('youtube_channel_url', e.target.value)}
                    maxLength={255}
                    placeholder="https://youtube.com/@yourstation"
                    className="input w-full"
                  />
                </FormField>
              </div>
            </section>

            {/* Branding */}
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-4">
                Branding
              </h2>
              <div className="space-y-4">
                <FormField
                  label="Logo URL"
                  description="Direct URL to the station logo image"
                >
                  <input
                    type="text"
                    value={form.logo_url}
                    onChange={(e) => setField('logo_url', e.target.value)}
                    maxLength={500}
                    placeholder="https://example.com/logo.png"
                    className="input w-full"
                  />
                </FormField>
                <FormField
                  label="Website URL"
                  description="Station's main website"
                >
                  <input
                    type="text"
                    value={form.website_url}
                    onChange={(e) => setField('website_url', e.target.value)}
                    maxLength={255}
                    placeholder="https://yourstation.com"
                    className="input w-full"
                  />
                </FormField>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    label="Primary Color"
                    description="Main brand color (hex)"
                  >
                    <ColorInput
                      value={form.primary_color}
                      onChange={(v) => setField('primary_color', v)}
                    />
                  </FormField>
                  <FormField
                    label="Secondary Color"
                    description="Accent brand color (hex)"
                  >
                    <ColorInput
                      value={form.secondary_color}
                      onChange={(v) => setField('secondary_color', v)}
                    />
                  </FormField>
                </div>
              </div>
            </section>

            {/* Save */}
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Details'}
              </button>
              {saveSuccess && (
                <span className="text-sm text-green-400">Details saved.</span>
              )}
              {saveError && (
                <span className="text-sm text-red-400">{saveError}</span>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}

// ─── FormField ────────────────────────────────────────────────────────────────

interface FormFieldProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function FormField({ label, description, children }: FormFieldProps) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-0.5 font-medium">{label}</label>
      {description && <p className="text-xs text-gray-500 mb-1.5">{description}</p>}
      {children}
    </div>
  );
}

// ─── ColorInput ───────────────────────────────────────────────────────────────

interface ColorInputProps {
  value: string;
  onChange: (v: string) => void;
}

function ColorInput({ value, onChange }: ColorInputProps) {
  const isValid = /^#[0-9A-Fa-f]{6}$/.test(value);

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={isValid ? value : '#7c3aed'}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-9 rounded cursor-pointer border border-[#2a2a40] bg-[#13131a] p-0.5"
        title="Pick a color"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={7}
        placeholder="#7c3aed"
        className={`input flex-1 font-mono text-sm ${!isValid && value ? 'border-red-600/60' : ''}`}
      />
    </div>
  );
}
