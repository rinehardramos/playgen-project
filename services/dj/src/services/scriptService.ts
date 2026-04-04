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
        audio_file_path, audio_duration_ms, before_song_id, after_song_id, review_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        data.dj_script_id, data.dj_profile_id, data.segment_type, data.script_text,
        data.audio_file_path, data.audio_duration_ms, data.before_song_id, data.after_song_id,
        data.review_status || 'pending'
      ]
    );
    return rows[0];
  },

  async updateScriptReview(id: string, data: {
    status: 'pending' | 'approved' | 'rejected';
    notes?: string;
    userId: string;
  }): Promise<void> {
    await getPool().query(
      `UPDATE dj_scripts 
       SET review_status = $2, review_notes = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id, data.status, data.notes || null, data.userId]
    );
  },

  async updateSegmentReview(id: string, status: 'pending' | 'approved' | 'rejected' | 'edited'): Promise<void> {
    await getPool().query(
      'UPDATE dj_segments SET review_status = $2, updated_at = NOW() WHERE id = $1',
      [id, status]
    );
  },

  async updateSegmentText(id: string, text: string): Promise<void> {
    await getPool().query(
      "UPDATE dj_segments SET script_text = $2, review_status = 'edited', updated_at = NOW() WHERE id = $1",
      [id, text]
    );
  },

  async getSegment(id: string): Promise<DJSegment | null> {
    const { rows } = await getPool().query('SELECT * FROM dj_segments WHERE id = $1', [id]);
    return rows[0] || null;
  }
};
