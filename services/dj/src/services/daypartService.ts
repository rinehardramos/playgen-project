import { getPool } from '../db.js';
import type { DjDaypartAssignment, DjDaypart } from '@playgen/types';

export async function listDayparts(station_id: string): Promise<DjDaypartAssignment[]> {
  const { rows } = await getPool().query<DjDaypartAssignment>(
    `SELECT * FROM dj_daypart_assignments WHERE station_id = $1 ORDER BY start_hour`,
    [station_id],
  );
  return rows;
}

export async function getDaypartForHour(station_id: string, hour: number): Promise<DjDaypartAssignment | null> {
  const { rows } = await getPool().query<DjDaypartAssignment>(
    `SELECT * FROM dj_daypart_assignments
     WHERE station_id = $1 AND start_hour <= $2 AND end_hour > $2
     LIMIT 1`,
    [station_id, hour],
  );
  return rows[0] ?? null;
}

export async function upsertDaypart(
  station_id: string,
  daypart: DjDaypart,
  dj_profile_id: string,
  start_hour: number,
  end_hour: number,
): Promise<DjDaypartAssignment> {
  const { rows } = await getPool().query<DjDaypartAssignment>(
    `INSERT INTO dj_daypart_assignments (station_id, dj_profile_id, daypart, start_hour, end_hour)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (station_id, daypart)
     DO UPDATE SET dj_profile_id = EXCLUDED.dj_profile_id,
                   start_hour = EXCLUDED.start_hour,
                   end_hour = EXCLUDED.end_hour,
                   updated_at = NOW()
     RETURNING *`,
    [station_id, dj_profile_id, daypart, start_hour, end_hour],
  );
  return rows[0];
}

export async function deleteDaypart(station_id: string, daypart: DjDaypart): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM dj_daypart_assignments WHERE station_id = $1 AND daypart = $2`,
    [station_id, daypart],
  );
  return (rowCount ?? 0) > 0;
}
