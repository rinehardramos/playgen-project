import { getPool } from '../db';
import { Station } from '@playgen/types';

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
  const { rows } = await getPool().query<Station>(
    `INSERT INTO stations (company_id, name, timezone, broadcast_start_hour, broadcast_end_hour, active_days)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      data.company_id,
      data.name,
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
}>): Promise<Station | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const allowed = ['name','timezone','broadcast_start_hour','broadcast_end_hour','active_days','is_active','dj_enabled','dj_auto_approve'] as const;
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
