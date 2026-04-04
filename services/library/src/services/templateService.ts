import { getPool } from '../db';
import { Template, TemplateSlot } from '@playgen/types';

export interface TemplateWithSlots extends Template {
  slots: TemplateSlot[];
}

export async function listTemplates(stationId: string): Promise<Template[]> {
  const { rows } = await getPool().query<Template>(
    'SELECT * FROM templates WHERE station_id = $1 ORDER BY is_default DESC, name',
    [stationId]
  );
  return rows;
}

export async function getTemplate(id: string): Promise<TemplateWithSlots | null> {
  const pool = getPool();
  const { rows: tmpl } = await pool.query<Template>(
    'SELECT * FROM templates WHERE id = $1',
    [id]
  );
  if (!tmpl[0]) return null;
  const { rows: slots } = await pool.query<TemplateSlot>(
    'SELECT * FROM template_slots WHERE template_id = $1 ORDER BY hour, position',
    [id]
  );
  return { ...tmpl[0], slots };
}

export async function createTemplate(data: {
  station_id: string;
  name: string;
  type: '1_day' | '3_hour' | '4_hour';
  is_default?: boolean;
}): Promise<Template> {
  const pool = getPool();

  // Un-default existing default if we're setting a new one
  if (data.is_default) {
    await pool.query(
      'UPDATE templates SET is_default = false WHERE station_id = $1',
      [data.station_id]
    );
  }

  const { rows } = await pool.query<Template>(
    `INSERT INTO templates (station_id, name, type, is_default)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.station_id, data.name, data.type, data.is_default ?? false]
  );
  return rows[0];
}

export async function updateTemplate(id: string, data: Partial<{
  name: string;
  type: '1_day' | '3_hour' | '4_hour';
  is_default: boolean;
  is_active: boolean;
}>): Promise<Template | null> {
  const pool = getPool();

  if (data.is_default) {
    // Fetch station_id first
    const { rows: existing } = await pool.query<Template>('SELECT station_id FROM templates WHERE id = $1', [id]);
    if (existing[0]) {
      await pool.query('UPDATE templates SET is_default = false WHERE station_id = $1', [existing[0].station_id]);
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const allowed = ['name', 'type', 'is_default', 'is_active'] as const;
  for (const key of allowed) {
    if (data[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(data[key]); }
  }
  if (!fields.length) {
    const { rows } = await pool.query<Template>('SELECT * FROM templates WHERE id = $1', [id]);
    return rows[0] ?? null;
  }
  fields.push('updated_at = NOW()');
  values.push(id);
  const { rows } = await pool.query<Template>(
    `UPDATE templates SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query('DELETE FROM templates WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

// ── Template Slots ─────────────────────────────────────────────────────────────

export async function setTemplateSlots(
  templateId: string,
  slots: Array<{ hour: number; position: number; required_category_id: string }>
): Promise<TemplateSlot[]> {
  const pool = getPool();
  await pool.query('DELETE FROM template_slots WHERE template_id = $1', [templateId]);
  if (!slots.length) return [];

  const inserted: TemplateSlot[] = [];
  for (const s of slots) {
    const { rows } = await pool.query<TemplateSlot>(
      `INSERT INTO template_slots (template_id, hour, position, required_category_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (template_id, hour, position) DO UPDATE
         SET required_category_id = EXCLUDED.required_category_id
       RETURNING *`,
      [templateId, s.hour, s.position, s.required_category_id]
    );
    inserted.push(rows[0]);
  }
  return inserted.sort((a, b) => a.hour - b.hour || a.position - b.position);
}

export async function upsertTemplateSlot(
  templateId: string,
  slot: { hour: number; position: number; required_category_id: string }
): Promise<TemplateSlot> {
  const { rows } = await getPool().query<TemplateSlot>(
    `INSERT INTO template_slots (template_id, hour, position, required_category_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (template_id, hour, position) DO UPDATE
       SET required_category_id = EXCLUDED.required_category_id
     RETURNING *`,
    [templateId, slot.hour, slot.position, slot.required_category_id]
  );
  return rows[0];
}

export async function deleteTemplateSlot(templateId: string, hour: number, position: number): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'DELETE FROM template_slots WHERE template_id = $1 AND hour = $2 AND position = $3',
    [templateId, hour, position]
  );
  return (rowCount ?? 0) > 0;
}

export async function cloneTemplate(templateId: string, targetStationId: string): Promise<TemplateWithSlots> {
  const pool = getPool();
  
  // 1. Fetch source template and slots
  const source = await getTemplate(templateId);
  if (!source) throw new Error('Source template not found');

  // 2. Fetch all categories for source and target to map them by code
  const { rows: sourceCats } = await pool.query<{ id: string, code: string }>(
    'SELECT id, code FROM categories WHERE station_id = $1',
    [source.station_id]
  );
  const { rows: targetCats } = await pool.query<{ id: string, code: string }>(
    'SELECT id, code FROM categories WHERE station_id = $1',
    [targetStationId]
  );

  const targetCatMap = new Map(targetCats.map(c => [c.code, c.id]));
  const sourceCatIdToCode = new Map(sourceCats.map(c => [c.id, c.code]));

  // 3. Create the new template
  const newTemplate = await createTemplate({
    station_id: targetStationId,
    name: `${source.name} (Copy)`,
    type: source.type,
    is_default: false,
  });

  // 4. Map and insert slots
  const newSlots: Array<{ hour: number; position: number; required_category_id: string }> = [];
  for (const slot of source.slots) {
    const code = sourceCatIdToCode.get(slot.required_category_id);
    if (!code) continue; // Should not happen

    const targetCatId = targetCatMap.get(code);
    if (targetCatId) {
      newSlots.push({
        hour: slot.hour,
        position: slot.position,
        required_category_id: targetCatId,
      });
    }
  }

  if (newSlots.length > 0) {
    await setTemplateSlots(newTemplate.id, newSlots);
  }

  return getTemplate(newTemplate.id) as Promise<TemplateWithSlots>;
}
