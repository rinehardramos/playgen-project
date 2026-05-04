// ─── Subscription & Tier ─────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'paused';
export type AccountType = 'individual' | 'corporate';

export interface Subscription {
  id: string;
  company_id: string;
  stripe_subscription_id: string | null;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface TierLimits {
  tier: SubscriptionTier;
  max_stations: number;
  max_users: number;
  max_songs: number;
  max_sub_stations: number;
  feature_dj: boolean;
  feature_analytics: boolean;
  feature_s3: boolean;
  feature_api_keys: boolean;
  feature_custom_roles: boolean;
  feature_hierarchy: boolean;
}

export type TierFeature = 'dj' | 'analytics' | 's3' | 'api_keys' | 'custom_roles' | 'hierarchy';
export type TierResource = 'stations' | 'users' | 'songs';

export interface TierCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  tier: SubscriptionTier;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;      // user ID
  cid: string;      // company_id
  rc: string;       // role_code
  tier: SubscriptionTier;  // subscription tier
  sys?: true;       // present only for super_admin / company_admin
  pv: number;       // perm_version — detects stale caches
  iat: number;
  exp: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export type RoleCode =
  | 'super_admin'
  | 'company_admin'
  | 'station_admin'
  | 'scheduler'
  | 'viewer'
  | 'general_manager'
  | 'program_director'
  | 'music_director'
  | 'traffic_manager'
  | 'on_air_talent'
  | 'viewer_template';

export const PERMISSIONS = [
  'company:read', 'company:write',
  'station:read', 'station:write', 'station:create', 'station:delete',
  'library:read', 'library:write', 'library:delete',
  'template:read', 'template:write',
  'playlist:read', 'playlist:write', 'playlist:approve', 'playlist:export',
  'analytics:read', 'analytics:export',
  'users:read', 'users:write', 'users:invite',
  'roles:read', 'roles:write',
  'rules:read', 'rules:write',
  'dj:read', 'dj:write', 'dj:approve', 'dj:config',
  'settings:read', 'settings:write',
  'billing:read', 'billing:write',
  'program:read', 'program:write',
] as const;

export type Permission_Code = typeof PERMISSIONS[number];

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  super_admin: PERMISSIONS,
  company_admin: PERMISSIONS,
  station_admin: [
    'station:read', 'station:write',
    'library:read', 'library:write', 'library:delete',
    'template:read', 'template:write',
    'playlist:read', 'playlist:write', 'playlist:approve', 'playlist:export',
    'analytics:read',
    'users:read', 'users:write', 'users:invite',
    'roles:read',
    'rules:read', 'rules:write',
    'dj:read', 'dj:write', 'dj:approve', 'dj:config',
    'settings:read', 'settings:write',
    'program:read', 'program:write',
  ],
  scheduler: ['playlist:read', 'playlist:write', 'template:read', 'rules:read'],
  viewer: ['library:read', 'template:read', 'playlist:read', 'analytics:read', 'program:read'],
  general_manager: [
    'station:read', 'station:write',
    'library:read', 'library:write', 'library:delete',
    'template:read', 'template:write',
    'playlist:read', 'playlist:write', 'playlist:approve', 'playlist:export',
    'analytics:read', 'analytics:export',
    'users:read', 'users:write', 'users:invite',
    'roles:read',
    'rules:read', 'rules:write',
    'dj:read', 'dj:write', 'dj:approve', 'dj:config',
    'settings:read', 'settings:write',
    'program:read', 'program:write',
  ],
  program_director: [
    'library:read', 'library:write', 'library:delete',
    'template:read', 'template:write',
    'playlist:read', 'playlist:write', 'playlist:approve', 'playlist:export',
    'analytics:read',
    'rules:read', 'rules:write',
    'dj:read', 'dj:write', 'dj:approve',
    'program:read', 'program:write',
  ],
  music_director: ['library:read', 'library:write', 'template:read', 'playlist:read', 'rules:read', 'dj:read', 'program:read'],
  traffic_manager: [
    'library:read', 'template:read',
    'playlist:read', 'playlist:write', 'playlist:approve', 'playlist:export',
    'analytics:read', 'rules:read',
    'program:read',
  ],
  on_air_talent: ['library:read', 'playlist:read', 'dj:read', 'dj:write', 'program:read'],
  viewer_template: ['library:read', 'template:read', 'playlist:read', 'analytics:read', 'program:read'],
};

// ─── Permissions ─────────────────────────────────────────────────────────────

export interface Permission {
  id: string;
  code: string;
  resource: string;
  action: string;
  label: string;
  description: string | null;
  category: string;
  sort_order: number;
}

export interface UserStationAssignment {
  id: string;
  user_id: string;
  station_id: string;
  role_override_id: string | null;
  assigned_by: string | null;
  created_at: string;
}

export interface ResolvedPermissions {
  companyWide: string[];                        // permission codes for company-wide access
  stationSpecific: Map<string, string[]>;       // stationId → permission codes
  accessibleStationIds: string[];
}

// ─── Company & Station ───────────────────────────────────────────────────────

export type StationType = 'group' | 'market' | 'cluster' | 'station' | 'subchannel';

export interface Company {
  id: string;
  name: string;
  slug: string;
  account_type?: AccountType;
  stripe_customer_id?: string | null;
  settings?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Station {
  id: string;
  company_id: string;
  name: string;
  timezone: string;
  broadcast_start_hour: number;
  broadcast_end_hour: number;
  active_days: string[];
  is_active: boolean;
  dj_enabled: boolean;
  dj_auto_approve: boolean;
  parent_station_id?: string | null;
  station_type?: StationType;
  depth?: number;
  inherit_library?: boolean;
  is_master_library?: boolean;
  sort_order?: number;
  created_at: Date;
  updated_at: Date;
  // Identity (added in migration 039)
  callsign?: string | null;
  tagline?: string | null;
  frequency?: string | null;
  broadcast_type?: 'fm' | 'am' | 'online' | 'podcast' | 'dab' | null;
  // Locale
  city?: string | null;
  province?: string | null;
  country?: string | null;
  locale_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  // Social media
  facebook_page_id?: string | null;
  facebook_page_url?: string | null;
  twitter_handle?: string | null;
  instagram_handle?: string | null;
  youtube_channel_url?: string | null;
  // Branding
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  website_url?: string | null;
  /** DALL-E generated abstract cover art URL (nullable until generated). Added in migration 072. */
  artwork_url?: string | null;
  /** Declarative station blueprint. Drives DJ personality, script rules, and music guidelines. Added in migration 076. */
  station_spec?: StationSpec | null;
}

export interface Role {
  id: string;
  company_id: string | null;
  code: RoleCode | string;
  label: string;
  permissions: string[];
  is_system?: boolean;
  is_template?: boolean;
  description?: string | null;
}

export interface User {
  id: string;
  company_id: string;
  role_id: string;
  email: string;
  display_name: string;
  station_ids: string[];
  default_station_id?: string | null;
  perm_version?: number;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Library ─────────────────────────────────────────────────────────────────

export interface Category {
  id: string;
  station_id: string;
  code: string;
  label: string;
  rotation_weight: number;
  color_tag: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface Song {
  id: string;
  company_id: string;
  station_id: string;
  category_id: string;
  title: string;
  artist: string;
  duration_sec: number | null;
  is_active: boolean;
  raw_material: string | null;
  audio_url: string | null;
  audio_source: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SongWithSlots extends Song {
  eligible_hours: number[];
}

// ─── Templates ───────────────────────────────────────────────────────────────

export type TemplateType = '1_day' | '3_hour' | '4_hour';

export interface Template {
  id: string;
  station_id: string;
  name: string;
  type: TemplateType;
  is_default: boolean;
  day_of_week_overrides: Record<string, boolean | string>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TemplateSlot {
  id: string;
  template_id: string;
  hour: number;
  position: number;
  required_category_id: string;
}

// ─── Playlists ───────────────────────────────────────────────────────────────

export type PlaylistStatus = 'draft' | 'generating' | 'ready' | 'approved' | 'exported' | 'failed';

export interface Playlist {
  id: string;
  station_id: string;
  template_id: string | null;
  date: string;
  status: PlaylistStatus;
  generated_at: Date | null;
  generated_by: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  notes: string | null;
}

export interface PlaylistEntry {
  id: string;
  playlist_id: string;
  hour: number;
  position: number;
  song_id: string;
  is_manual_override: boolean;
  overridden_by: string | null;
  overridden_at: Date | null;
}

// ─── Rotation Rules ───────────────────────────────────────────────────────────

export interface RotationRules {
  max_plays_per_day: number;
  min_gap_hours: number;
  max_same_artist_per_hour: number;
  artist_separation_slots: number;
  category_weights: Record<string, number>;
}

export const DEFAULT_ROTATION_RULES: RotationRules = {
  max_plays_per_day: 1,
  min_gap_hours: 3,
  max_same_artist_per_hour: 1,
  artist_separation_slots: 4,
  category_weights: {},
};

// ─── Generation Jobs ─────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type JobTrigger = 'manual' | 'cron';

export interface GenerationJob {
  id: string;
  station_id: string;
  playlist_id: string | null;
  status: JobStatus;
  error_message: string | null;
  queued_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  triggered_by: JobTrigger;
}

// ─── DJ Service ───────────────────────────────────────────────────────────────

export type DjDaypart = 'morning' | 'midday' | 'afternoon' | 'evening' | 'overnight';
export type DjSegmentType =
  | 'show_intro'
  | 'song_intro'
  | 'song_transition'
  | 'show_outro'
  | 'station_id'
  | 'time_check'
  | 'weather_tease'
  | 'ad_break'
  | 'adlib'
  | 'joke'
  | 'current_events'
  | 'listener_activity';

export interface NewsHeadline {
  title: string;
  description?: string;
  source?: string;
}

export interface ListenerShoutout {
  id: string;
  station_id: string;
  submitted_by: string;
  listener_name: string | null;
  message: string;
  platform: string | null;
  status: 'pending' | 'used' | 'dismissed';
  used_in_script_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DjAdlibClip {
  id: string;
  station_id: string;
  name: string;
  audio_url: string;
  tags: string[];
  audio_duration_sec: number | null;
  file_size_bytes: number | null;
  original_filename: string | null;
  created_at: Date;
  updated_at: Date;
}

export type DjReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'auto_approved';
export type DjSegmentReviewStatus = 'pending' | 'approved' | 'edited' | 'rejected';
export type ManifestStatus = 'building' | 'ready' | 'failed';
export type TtsProvider = 'openai' | 'elevenlabs';
export type StorageProvider = 'local' | 's3';

export interface PersonaConfig {
  catchphrases?: string[];
  signature_greeting?: string;
  signature_signoff?: string;
  topics_to_avoid?: string[];
  energy_level?: number;       // 1-10
  humor_level?: number;        // 1-10
  formality?: 'casual' | 'balanced' | 'formal';
  backstory?: string;
  /** How often (in minutes of cumulative show content) to inject a station_id segment. Default: 30. */
  station_id_interval_minutes?: number;
  /** How often (in minutes of cumulative show content) to inject a time_check segment. Default: 60. */
  time_check_interval_minutes?: number;
  /** Joke style used for joke segments. Default: 'witty'. */
  joke_style?: 'clean' | 'witty' | 'pun' | 'observational';
  /** Every N songs an adlib segment is injected (default 4). Set to 0 to disable. */
  adlib_interval_songs?: number;
}

export interface DjProfile {
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
  /** DALL-E generated portrait URL (nullable until generated). Added in migration 071. */
  avatar_url?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DjDaypartAssignment {
  id: string;
  station_id: string;
  dj_profile_id: string;
  daypart: DjDaypart;
  start_hour: number;
  end_hour: number;
  created_at: Date;
  updated_at: Date;
}

export interface DjScriptTemplate {
  id: string;
  station_id: string;
  segment_type: DjSegmentType;
  name: string;
  prompt_template: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DjScript {
  id: string;
  playlist_id: string;
  station_id: string;
  dj_profile_id: string;
  review_status: DjReviewStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
  llm_model: string;
  generation_ms: number | null;
  total_segments: number;
  created_at: Date;
  updated_at: Date;
}

export interface DjSegment {
  id: string;
  script_id: string;
  playlist_entry_id: string | null;
  segment_type: DjSegmentType;
  position: number;
  script_text: string;
  edited_text: string | null;
  segment_review_status: DjSegmentReviewStatus;
  audio_url: string | null;
  audio_duration_sec: number | null;
  tts_provider: TtsProvider | null;
  tts_voice_id: string | null;
  tts_generated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DjShowManifest {
  id: string;
  script_id: string;
  station_id: string;
  status: ManifestStatus;
  storage_provider: StorageProvider;
  manifest_url: string | null;
  total_duration_sec: number | null;
  error_message: string | null;
  built_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Request / Response shapes used by the dj-service API

export interface GenerateScriptRequest {
  playlist_id: string;
  dj_profile_id?: string;   // falls back to station default
  secondary_dj_profile_id?: string;
  tertiary_dj_profile_id?: string;
  voice_map?: Record<string, string>;
  auto_approve?: boolean;
}

export interface ReviewScriptRequest {
  action: 'approve' | 'reject' | 'edit';
  review_notes?: string;
  edited_segments?: Array<{ id: string; edited_text: string }>;
}

export interface DjScriptWithSegments extends DjScript {
  segments: DjSegment[];
}

// ─── Weather / Data Plugins ───────────────────────────────────────────────────

/** Live weather forecast returned by any weather provider. */
export interface WeatherForecast {
  city: string;
  temperature_c: number;
  temperature_f: number;
  conditions: string;       // Short label, e.g. "Partly Cloudy"
  description: string;      // Longer description, e.g. "partly cloudy skies"
  humidity: number;         // 0–100 %
  wind_speed_kmh: number;
  summary: string;          // Human-readable one-liner for prompt injection
}

/** Generic extensible data-provider interface.
 *  Implement this to add new weather/news/data backends. */
export interface IDataProvider<TConfig = unknown, TResult = unknown> {
  /** Returns true when required config keys are present and non-empty. */
  isConfigured(cfg: TConfig): boolean;
  /** Fetches live data. Throws on unrecoverable error. */
  fetch(cfg: TConfig): Promise<TResult>;
}

/** Dedicated weather-provider interface (higher-level than IDataProvider). */
export interface IWeatherProvider {
  /** Fetch a forecast for the given coordinates and/or city name. */
  fetchForecast(lat: number | null, lon: number | null, city: string): Promise<WeatherForecast>;
}

// ─── Station Settings ─────────────────────────────────────────────────────────

/** Known per-station setting keys managed via the settings UI. */
export type StationSettingKey =
  | 'tts_provider'
  | 'tts_api_key'
  | 'tts_voice_id'
  | 'llm_model'
  | 'llm_api_key'
  | 'weather_provider'
  | 'weather_api_key';

export interface StationSetting {
  id: string;
  station_id: string;
  key: string;
  /** The real value — or "***" when is_secret=true in GET responses. */
  value: string;
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Programs & Episodes ──────────────────────────────────────────────────────

export type ProgramAirDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type EpisodeStatus = 'draft' | 'generating' | 'ready' | 'approved' | 'aired';

// ─── Program Themes ──────────────────────────────────────────────────────────

export type ProgramThemeType =
  | 'weather_reactive'
  | 'news_reactive'
  | 'sponsored'
  | 'social_driven'
  | 'custom'
  | 'event'
  | 'mood';

export interface ProgramTheme {
  id: string;
  type: ProgramThemeType;
  priority: number;           // 1-10 (higher = more influence)
  active: boolean;
  config: Record<string, unknown>;
}

export interface Program {
  id: string;
  station_id: string;
  name: string;
  description: string | null;
  active_days: string[];
  start_hour: number;
  end_hour: number;
  template_id: string | null;
  color_tag: string | null;
  dj_profile_id: string | null;
  themes: ProgramTheme[];
  is_active: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProgramRequest {
  name: string;
  description?: string;
  active_days?: string[];
  start_hour?: number;
  end_hour?: number;
  template_id?: string | null;
  color_tag?: string | null;
  is_active?: boolean;
}

// ─── Show Format Clocks ───────────────────────────────────────────────────────

export type ClockContentType =
  | 'song'
  | 'dj_segment'
  | 'weather'
  | 'news'
  | 'adlib'
  | 'joke'
  | 'time_check'
  | 'station_id'
  | 'ad_break'
  | 'listener_activity';

export interface ShowFormatClock {
  id: string;
  program_id: string;
  name: string;
  applies_to_hours: number[] | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ShowClockSlot {
  id: string;
  clock_id: string;
  position: number;
  content_type: ClockContentType;
  category_id: string | null;
  segment_type: string | null;
  target_minute: number | null;
  duration_est_sec: number | null;
  is_required: boolean;
  notes: string | null;
}

// ─── Program Episodes ─────────────────────────────────────────────────────────

export interface ProgramEpisode {
  id: string;
  program_id: string;
  air_date: string;  // YYYY-MM-DD
  playlist_id: string | null;
  dj_script_id: string | null;
  manifest_id: string | null;
  status: EpisodeStatus;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateEpisodeRequest {
  air_date: string;
  playlist_id?: string;
  dj_script_id?: string;
  notes?: string;
}

// ─── System Logs ─────────────────────────────────────────────────────────────

export type SystemLogLevel = 'info' | 'warn' | 'error';

export type SystemLogCategory = 'dj' | 'tts' | 'review' | 'config' | 'playlist' | 'auth' | 'system';

export interface SystemLogEntry {
  id: string;
  created_at: string;
  level: SystemLogLevel;
  category: SystemLogCategory;
  company_id: string | null;
  station_id: string | null;
  user_id: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
}

export interface SystemLogsResponse {
  data: SystemLogEntry[];
  total: number;
  page: number;
  pages: number;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// ─── Station Spec ─────────────────────────────────────────────────────────────

/** Voice config within a spec DJ definition. */
export interface SpecDjVoice {
  provider: string;
  voice_id: string;
}

/** DJ persona definition within a station spec. */
export interface SpecDj {
  name: string;
  role?: 'primary' | 'co-host' | 'guest';
  voice?: SpecDjVoice;
  personality?: string;
  energy?: number;          // 1-10
  humor?: number;           // 1-10
  formality?: 'casual' | 'balanced' | 'formal';
  catchphrases?: string[];
  greeting?: string;
  signoff?: string;
  backstory?: string;
}

/** DJ interaction rules within a station spec. */
export interface SpecDjInteraction {
  style?: 'solo' | 'banter' | 'formal';
  rules?: string[];
}

/** Program theme directive within a station spec. */
export interface SpecProgramTheme {
  type: ProgramThemeType;
  priority?: number;
  config?: Record<string, unknown>;
}

/** Program definition within a station spec. */
export interface SpecProgram {
  name: string;
  hours?: string;           // e.g. "5-12" or "22-2"
  start_hour?: number;
  end_hour?: number;
  active_days?: string[];
  dj_combo?: string[];      // DJ names that appear in this program
  themes?: SpecProgramTheme[];
}

/** Music library guidelines within a station spec. */
export interface SpecLibrary {
  songs_per_hour?: number;
  rules?: string[];
}

/** TTS configuration within a station spec. */
export interface SpecTts {
  provider?: string;
  default_voice?: string;
}

/**
 * Declarative station blueprint — like CLAUDE.md but for stations.
 * All fields are optional; a partial spec only overrides the fields present.
 * Stored as JSONB in `stations.station_spec` (migration 076).
 */
export interface StationSpec {
  /** Spec format version (currently "1"). */
  version?: string;

  // ── Identity ──────────────────────────────────────────────────────────────
  name?: string;
  callsign?: string;
  tagline?: string;
  locale?: string;
  city?: string;
  timezone?: string;
  frequency?: string;
  broadcast_type?: 'fm' | 'am' | 'online' | 'podcast' | 'dab';

  // ── Broadcast schedule ────────────────────────────────────────────────────
  broadcast?: {
    start_hour?: number;
    end_hour?: number;
    active_days?: string[];
  };

  // ── TTS config ────────────────────────────────────────────────────────────
  tts?: SpecTts;

  // ── DJ personas ───────────────────────────────────────────────────────────
  djs?: SpecDj[];

  // ── DJ interaction rules ──────────────────────────────────────────────────
  dj_interaction?: SpecDjInteraction;

  // ── Programs ──────────────────────────────────────────────────────────────
  programs?: SpecProgram[];

  // ── Music guidelines ─────────────────────────────────────────────────────
  library?: SpecLibrary;

  // ── Script style rules (injected into the LLM system prompt) ─────────────
  script_rules?: {
    language?: string;
    tone?: string;
    segment_length?: string;
    avoid?: string[];
    always?: string[];
  };
}
