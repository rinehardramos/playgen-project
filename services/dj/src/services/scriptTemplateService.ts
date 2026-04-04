import { getPool } from '../db.js';
import type { DjScriptTemplate, DjSegmentType } from '@playgen/types';

export async function listTemplates(station_id: string): Promise<DjScriptTemplate[]> {
  const { rows } = await getPool().query<DjScriptTemplate>(
    `SELECT * FROM dj_script_templates WHERE station_id = $1 ORDER BY segment_type`,
    [station_id],
  );
  return rows;
}

export async function getTemplate(
  station_id: string,
  segment_type: DjSegmentType,
): Promise<DjScriptTemplate | null> {
  const { rows } = await getPool().query<DjScriptTemplate>(
    `SELECT * FROM dj_script_templates
     WHERE station_id = $1 AND segment_type = $2 AND is_active = TRUE
     LIMIT 1`,
    [station_id, segment_type],
  );
  return rows[0] ?? null;
}

export async function createTemplate(
  station_id: string,
  data: { segment_type: DjSegmentType; name: string; prompt_template: string },
): Promise<DjScriptTemplate> {
  const { rows } = await getPool().query<DjScriptTemplate>(
    `INSERT INTO dj_script_templates (station_id, segment_type, name, prompt_template)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [station_id, data.segment_type, data.name, data.prompt_template],
  );
  return rows[0];
}

export async function updateTemplate(
  id: string,
  station_id: string,
  data: Partial<{ name: string; prompt_template: string; is_active: boolean }>,
): Promise<DjScriptTemplate | null> {
  const { rows } = await getPool().query<DjScriptTemplate>(
    `UPDATE dj_script_templates
     SET name = COALESCE($3, name),
         prompt_template = COALESCE($4, prompt_template),
         is_active = COALESCE($5, is_active),
         updated_at = NOW()
     WHERE id = $1 AND station_id = $2
     RETURNING *`,
    [id, station_id, data.name ?? null, data.prompt_template ?? null, data.is_active ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteTemplate(id: string, station_id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM dj_script_templates WHERE id = $1 AND station_id = $2`,
    [id, station_id],
  );
  return (rowCount ?? 0) > 0;
}
