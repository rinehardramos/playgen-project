import { DJDaypartAssignment, DJProfile } from '@playgen/types';
import { getPool } from '../db';

export const daypartService = {
  async list(stationId: string): Promise<DJDaypartAssignment[]> {
    const { rows } = await getPool().query(
      'SELECT * FROM dj_daypart_assignments WHERE station_id = $1 ORDER BY priority DESC, start_hour ASC',
      [stationId]
    );
    return rows;
  },

  async create(stationId: string, data: Omit<DJDaypartAssignment, 'id' | 'station_id' | 'created_at' | 'updated_at'>): Promise<DJDaypartAssignment> {
    const { rows } = await getPool().query(
      `INSERT INTO dj_daypart_assignments (
        station_id, dj_profile_id, start_hour, end_hour, days_of_week, priority
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [stationId, data.dj_profile_id, data.start_hour, data.end_hour, data.days_of_week, data.priority]
    );
    return rows[0];
  },

  async update(id: string, data: Partial<Omit<DJDaypartAssignment, 'id' | 'station_id' | 'created_at' | 'updated_at'>>): Promise<DJDaypartAssignment | null> {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');

    const { rows } = await getPool().query(
      `UPDATE dj_daypart_assignments SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    return rows[0] || null;
  },

  async delete(id: string): Promise<void> {
    await getPool().query('DELETE FROM dj_daypart_assignments WHERE id = $1', [id]);
  },

  async resolveProfileForHour(stationId: string, hour: number, dayOfWeek: string): Promise<DJProfile | null> {
    const pool = getPool();

    // 1. Resolve daypart assignment with highest priority
    // Handle wrap-around (e.g. start=22, end=4)
    const { rows: assignments } = await pool.query(
      `SELECT * FROM dj_daypart_assignments 
       WHERE station_id = $1 
       AND $2 = ANY(days_of_week)
       AND (
         (start_hour <= end_hour AND $3 >= start_hour AND $3 < end_hour)
         OR (start_hour > end_hour AND ($3 >= start_hour OR $3 < end_hour))
       )
       ORDER BY priority DESC, created_at DESC
       LIMIT 1`,
      [stationId, dayOfWeek, hour]
    );

    if (assignments.length > 0) {
      const { rows: profiles } = await pool.query(
        'SELECT * FROM dj_profiles WHERE id = $1 AND is_active = TRUE',
        [assignments[0].dj_profile_id]
      );
      if (profiles.length > 0) return profiles[0];
    }

    // 2. Fallback to station's default profile
    const { rows: defaults } = await pool.query(
      'SELECT * FROM dj_profiles WHERE station_id = $1 AND is_default = TRUE AND is_active = TRUE LIMIT 1',
      [stationId]
    );

    if (defaults.length > 0) return defaults[0];

    // 3. Last resort hardcoded fallback (Alex)
    return {
      id: '00000000-0000-0000-0000-000000000000',
      station_id: stationId,
      name: 'Alex',
      tone: 'friendly',
      energy_level: 'medium',
      persona_prompt: 'You are Alex, a friendly AI DJ.',
      catchphrases: ['Keep the vibes going'],
      voice_config: { provider: 'openai', voice_id: 'nova', speed: 1.0 },
      is_default: true,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }
};
