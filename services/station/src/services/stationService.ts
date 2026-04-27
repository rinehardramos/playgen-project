import { getPool } from '../db';
import { Station } from '@playgen/types';
import { seedDefaultDjProfileForStation } from './djSetupService';

export async function listStations(companyId: string): Promise<Station[]> {
  const { rows } = await getPool().query<Station>(
    'SELECT * FROM stations WHERE company_id = $1 ORDER BY name',
    [companyId]
  );
  return rows;
}

export async function getStation(id: string): Promise<Station | null> {
  const { rows } = await getPool().query<Station>('SELECT * FROM stations WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function createStation(data: {
  company_id: string;
  name: string;
  timezone?: string;
  broadcast_start_hour?: number;
  broadcast_end_hour?: number;
  active_days?: string[];
}): Promise<Station> {
  // Auto-generate slug from name if not provided
  const slug = data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const { rows } = await getPool().query<Station>(
    `INSERT INTO stations (company_id, name, slug, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      data.company_id,
      data.name,
      slug,
      data.timezone ?? 'Asia/Manila',
      data.broadcast_start_hour ?? 4,
      data.broadcast_end_hour ?? 3,
      data.active_days ?? ['MON','TUE','WED','THU','FRI','SAT','SUN'],
    ]
  );

  // Create default rotation rules for the new station
  await getPool().query(
    'INSERT INTO rotation_rules (station_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [rows[0].id]
  );

  // Seed default DJ profile and daypart assignments for the new station
  seedDefaultDjProfileForStation(data.company_id, rows[0].id).catch((err) => {
    console.error('[station] Failed to seed default DJ profile:', err);
  });

  // Auto-provision defaults: category, template with slots, program
  seedDefaultStationDefaults(rows[0].id, data.name, data.broadcast_start_hour ?? 4, data.broadcast_end_hour ?? 3).catch((err) => {
    console.error('[station] Failed to seed defaults:', err);
  });

  return rows[0];
}

export async function updateStation(id: string, data: Partial<{
  name: string;
  timezone: string;
  broadcast_start_hour: number;
  broadcast_end_hour: number;
  active_days: string[];
  is_active: boolean;
  dj_enabled: boolean;
  dj_auto_approve: boolean;
  openai_api_key: string;
  elevenlabs_api_key: string;
  openrouter_api_key: string;
  // Identity (migration 039)
  callsign: string;
  tagline: string;
  frequency: string;
  broadcast_type: string;
  // Locale
  city: string;
  province: string;
  country: string;
  locale_code: string;
  latitude: number;
  longitude: number;
  // Social media
  facebook_page_id: string;
  facebook_page_url: string;
  twitter_handle: string;
  instagram_handle: string;
  youtube_channel_url: string;
  // Branding
  logo_url: string;
  primary_color: string;
  secondary_color: string;
  website_url: string;
  // OwnRadio integration
  slug: string;
}>): Promise<Station | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const allowed = [
    'name', 'timezone', 'broadcast_start_hour', 'broadcast_end_hour', 'active_days',
    'is_active', 'dj_enabled', 'dj_auto_approve',
    'openai_api_key', 'elevenlabs_api_key', 'openrouter_api_key',
    // Identity
    'callsign', 'tagline', 'frequency', 'broadcast_type',
    // Locale
    'city', 'province', 'country', 'locale_code', 'latitude', 'longitude',
    // Social media
    'facebook_page_id', 'facebook_page_url', 'twitter_handle', 'instagram_handle', 'youtube_channel_url',
    // Branding
    'logo_url', 'primary_color', 'secondary_color', 'website_url',
    // OwnRadio integration
    'slug',
  ] as const;
  for (const key of allowed) {
    if (data[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(data[key]); }
  }
  if (!fields.length) return getStation(id);
  fields.push('updated_at = NOW()');
  values.push(id);
  const { rows } = await getPool().query<Station>(
    `UPDATE stations SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteStation(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query('DELETE FROM stations WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Auto-provision defaults for a new station:
 * 1. Default category (GEN / General)
 * 2. Default template (1_day) with hourly slots
 * 3. Default program linked to the template, active all days
 *
 * Fire-and-forget — failures logged but don't block station creation.
 */
async function seedDefaultStationDefaults(
  stationId: string,
  stationName: string,
  broadcastStartHour: number,
  broadcastEndHour: number,
): Promise<void> {
  const pool = getPool();

  // 1. Default category
  const { rows: catRows } = await pool.query<{ id: string }>(
    `INSERT INTO categories (station_id, code, label, rotation_weight)
     VALUES ($1, 'GEN', 'General', 1.0)
     ON CONFLICT (station_id, code) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [stationId],
  );
  const categoryId = catRows[0]?.id;
  if (!categoryId) return;

  // 2. Default template
  const { rows: tplRows } = await pool.query<{ id: string }>(
    `INSERT INTO templates (station_id, name, type, is_active, is_default)
     VALUES ($1, $2, '1_day', true, true)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [stationId, `${stationName} Default`],
  );
  const templateId = tplRows[0]?.id;
  if (!templateId) return;

  // 3. Template slots: 3 songs per hour for the broadcast window
  // Handle wrap-around (e.g., start=22, end=6 means 22,23,0,1,2,3,4,5)
  const hours: number[] = [];
  if (broadcastStartHour < broadcastEndHour) {
    for (let h = broadcastStartHour; h < broadcastEndHour; h++) hours.push(h);
  } else {
    for (let h = broadcastStartHour; h < 24; h++) hours.push(h);
    for (let h = 0; h < broadcastEndHour; h++) hours.push(h);
  }

  for (const hour of hours) {
    for (let pos = 1; pos <= 3; pos++) {
      await pool.query(
        `INSERT INTO template_slots (template_id, hour, position, required_category_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (template_id, hour, position) DO NOTHING`,
        [templateId, hour, pos, categoryId],
      );
    }
  }

  // 4. Default program — active all days, linked to the template
  // Use lowercase day names to match getDayOfWeek() in generationEngine
  const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  await pool.query(
    `INSERT INTO programs (station_id, name, active_days, start_hour, end_hour, is_active, template_id)
     VALUES ($1, $2, $3, $4, $5, true, $6)
     ON CONFLICT DO NOTHING`,
    [stationId, `${stationName} Show`, allDays, broadcastStartHour, broadcastEndHour, templateId],
  );

  console.info(`[station] Auto-provisioned defaults for station ${stationId}: category=${categoryId} template=${templateId}`);
}
