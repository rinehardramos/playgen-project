import { DJProfile } from '@playgen/types';
import { getPool } from '../db';

export const profileService = {
  async list(stationId: string): Promise<DJProfile[]> {
    const { rows } = await getPool().query(
      'SELECT * FROM dj_profiles WHERE station_id = $1 ORDER BY name ASC',
      [stationId]
    );
    return rows;
  },

  async get(id: string): Promise<DJProfile | null> {
    const { rows } = await getPool().query(
      'SELECT * FROM dj_profiles WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  async create(stationId: string, data: Omit<DJProfile, 'id' | 'station_id' | 'created_at' | 'updated_at'>): Promise<DJProfile> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      
      if (data.is_default) {
        await client.query(
          'UPDATE dj_profiles SET is_default = FALSE WHERE station_id = $1',
          [stationId]
        );
      }

      const { rows } = await client.query(
        `INSERT INTO dj_profiles (
          station_id, name, persona_prompt, tone, energy_level, 
          catchphrases, voice_config, is_default, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          stationId, data.name, data.persona_prompt, data.tone, data.energy_level,
          data.catchphrases, data.voice_config, data.is_default, data.is_active
        ]
      );
      
      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async update(id: string, data: Partial<Omit<DJProfile, 'id' | 'station_id' | 'created_at' | 'updated_at'>>): Promise<DJProfile | null> {
    const current = await this.get(id);
    if (!current) return null;

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      if (data.is_default) {
        await client.query(
          'UPDATE dj_profiles SET is_default = FALSE WHERE station_id = $1 AND id != $2',
          [current.station_id, id]
        );
      }

      const fields = Object.keys(data);
      const values = Object.values(data);
      const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');

      const { rows } = await client.query(
        `UPDATE dj_profiles SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...values]
      );

      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async deactivate(id: string): Promise<void> {
    await getPool().query(
      'UPDATE dj_profiles SET is_active = FALSE, is_default = FALSE, updated_at = NOW() WHERE id = $1',
      [id]
    );
  }
};
