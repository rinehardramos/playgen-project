import { getPool } from '../db';
import type { StationSetting } from '@playgen/types';

const MASK = '***';

/** Return all settings for a station, masking secret values. */
export async function listSettings(stationId: string): Promise<StationSetting[]> {
  const { rows } = await getPool().query<StationSetting>(
    `SELECT id, station_id, key, is_secret,
            CASE WHEN is_secret THEN $2 ELSE value END AS value,
            created_at, updated_at
     FROM station_settings
     WHERE station_id = $1
     ORDER BY key`,
    [stationId, MASK],
  );
  return rows;
}

/** Upsert a single setting. Returns the masked row. */
export async function upsertSetting(
  stationId: string,
  key: string,
  value: string,
  isSecret: boolean,
): Promise<StationSetting> {
  const { rows } = await getPool().query<StationSetting>(
    `INSERT INTO station_settings (station_id, key, value, is_secret)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (station_id, key) DO UPDATE
       SET value = EXCLUDED.value,
           is_secret = EXCLUDED.is_secret,
           updated_at = NOW()
     RETURNING
       id, station_id, key, is_secret,
       CASE WHEN is_secret THEN $5 ELSE value END AS value,
       created_at, updated_at`,
    [stationId, key, value, isSecret, MASK],
  );
  return rows[0];
}

/** Delete a setting. Returns true if a row was removed. */
export async function deleteSetting(stationId: string, key: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM station_settings WHERE station_id = $1 AND key = $2`,
    [stationId, key],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Resolve a setting value for internal use (un-masked).
 * Falls back to `fallback` if the setting is not set.
 */
export async function resolveSetting(
  stationId: string,
  key: string,
  fallback?: string,
): Promise<string | undefined> {
  const { rows } = await getPool().query<{ value: string }>(
    `SELECT value FROM station_settings WHERE station_id = $1 AND key = $2`,
    [stationId, key],
  );
  return rows[0]?.value ?? fallback;
}
