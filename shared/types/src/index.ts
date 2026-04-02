// ─── Auth ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;          // user id
  company_id: string;
  station_ids: string[];
  role_code: RoleCode;
  permissions: string[];
  iat?: number;
  exp?: number;
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
  | 'viewer';

export const PERMISSIONS = {
  COMPANY_READ: 'company:read',
  COMPANY_WRITE: 'company:write',
  STATION_READ: 'station:read',
  STATION_WRITE: 'station:write',
  LIBRARY_READ: 'library:read',
  LIBRARY_WRITE: 'library:write',
  TEMPLATE_READ: 'template:read',
  TEMPLATE_WRITE: 'template:write',
  PLAYLIST_READ: 'playlist:read',
  PLAYLIST_WRITE: 'playlist:write',
  PLAYLIST_APPROVE: 'playlist:approve',
  PLAYLIST_EXPORT: 'playlist:export',
  ANALYTICS_READ: 'analytics:read',
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  RULES_READ: 'rules:read',
  RULES_WRITE: 'rules:write',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  super_admin: Object.values(PERMISSIONS) as Permission[],
  company_admin: [
    'company:read', 'company:write',
    'station:read', 'station:write',
    'library:read', 'library:write',
    'template:read', 'template:write',
    'playlist:read', 'playlist:write', 'playlist:approve', 'playlist:export',
    'analytics:read',
    'users:read', 'users:write',
    'rules:read', 'rules:write',
  ],
  station_admin: [
    'station:read', 'station:write',
    'library:read', 'library:write',
    'template:read', 'template:write',
    'playlist:read', 'playlist:write', 'playlist:approve', 'playlist:export',
    'analytics:read',
    'users:read',
    'rules:read', 'rules:write',
  ],
  scheduler: [
    'library:read',
    'template:read',
    'playlist:read', 'playlist:write', 'playlist:export',
    'analytics:read',
  ],
  viewer: [
    'library:read',
    'playlist:read',
    'analytics:read',
  ],
};

// ─── Company & Station ───────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  slug: string;
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
  created_at: Date;
  updated_at: Date;
}

export interface Role {
  id: string;
  company_id: string | null;
  code: RoleCode;
  label: string;
  permissions: Permission[];
}

export interface User {
  id: string;
  company_id: string;
  role_id: string;
  email: string;
  display_name: string;
  station_ids: string[];
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
