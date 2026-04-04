import { DJScriptTemplate, ScriptSegmentType } from '@playgen/types';
import { getPool } from '../db';

export const scriptTemplateService = {
  async list(stationId: string): Promise<DJScriptTemplate[]> {
    const { rows } = await getPool().query(
      'SELECT * FROM dj_script_templates WHERE station_id = $1 OR station_id IS NULL ORDER BY segment_type ASC',
      [stationId]
    );
    return rows;
  },

  async get(id: string): Promise<DJScriptTemplate | null> {
    const { rows } = await getPool().query(
      'SELECT * FROM dj_script_templates WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  async upsert(stationId: string, segmentType: ScriptSegmentType, promptTemplate: string): Promise<DJScriptTemplate> {
    const { rows } = await getPool().query(
      `INSERT INTO dj_script_templates (station_id, segment_type, prompt_template)
       VALUES ($1, $2, $3)
       ON CONFLICT (station_id, segment_type) 
       DO UPDATE SET prompt_template = EXCLUDED.prompt_template, updated_at = NOW()
       RETURNING *`,
      [stationId, segmentType, promptTemplate]
    );
    return rows[0];
  },

  async delete(id: string): Promise<void> {
    await getPool().query('DELETE FROM dj_script_templates WHERE id = $1', [id]);
  },

  async getTemplateForSegment(stationId: string, segmentType: ScriptSegmentType): Promise<string | null> {
    const { rows } = await getPool().query(
      `SELECT prompt_template FROM dj_script_templates 
       WHERE (station_id = $1 OR station_id IS NULL) AND segment_type = $2
       ORDER BY station_id NULLS LAST LIMIT 1`,
      [stationId, segmentType]
    );

    if (rows[0]?.prompt_template) return rows[0].prompt_template;

    // Hardcoded fallbacks
    const fallbacks: Record<string, string> = {
      show_open: "Good {{time_of_day}}, {{station_name}}! I'm {{dj_name}} and we're kicking things off with {{song_title}} by {{artist}}.",
      segue: "That was {{prev_artist}} with '{{prev_song}}'. Coming up — {{artist}} with '{{song_title}}'.",
      song_intro: "Next up, {{artist}} with '{{song_title}}'.",
      time_check: "It's {{time}} — you're locked in with {{dj_name}} on {{station_name}}.",
      station_id: "{{station_name}} — playing the best music all day.",
      show_close: "That's a wrap from me, {{dj_name}}. Keep those vibes going."
    };

    return fallbacks[segmentType] || null;
  }
};
