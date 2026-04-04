import { DJScript, DJSegment, DJJobStatus, ScriptSegmentType } from '@playgen/types';
import { getPool } from '../db';

export const scriptService = {
  async createScript(stationId: string, playlistId: string): Promise<DJScript> {
    const { rows } = await getPool().query(
      `INSERT INTO dj_scripts (station_id, playlist_id, status)
       VALUES ($1, $2, 'queued')
       RETURNING *`,
      [stationId, playlistId]
    );
    return rows[0];
  },

  async updateScriptStatus(id: string, status: DJJobStatus, errorMessage?: string): Promise<void> {
    const completedAt = status === 'completed' ? 'NOW()' : 'NULL';
    await getPool().query(
      `UPDATE dj_scripts 
       SET status = $2, error_message = $3, updated_at = NOW(), completed_at = ${completedAt}
       WHERE id = $1`,
      [id, status, errorMessage || null]
    );
  },

  async getScript(id: string): Promise<DJScript | null> {
    const { rows } = await getPool().query('SELECT * FROM dj_scripts WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async getScriptWithSegments(id: string): Promise<(DJScript & { segments: DJSegment[] }) | null> {
    const script = await this.getScript(id);
    if (!script) return null;

    const { rows: segments } = await getPool().query(
      'SELECT * FROM dj_segments WHERE dj_script_id = $1 ORDER BY created_at ASC',
      [id]
    );

    return { ...script, segments };
  },

  async createSegment(data: Omit<DJSegment, 'id' | 'created_at' | 'updated_at'>): Promise<DJSegment> {
    const { rows } = await getPool().query(
      `INSERT INTO dj_segments (
        dj_script_id, dj_profile_id, segment_type, script_text, 
        audio_file_path, audio_duration_ms, before_song_id, after_song_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        data.dj_script_id, data.dj_profile_id, data.segment_type, data.script_text,
        data.audio_file_path, data.audio_duration_ms, data.before_song_id, data.after_song_id
      ]
    );
    return rows[0];
  }
};
