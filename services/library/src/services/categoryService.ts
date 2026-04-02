import { getPool } from '../db';
import { Category } from '@playgen/types';

export async function listCategories(stationId: string): Promise<Category[]> {
  const { rows } = await getPool().query<Category>(
    'SELECT * FROM categories WHERE station_id = $1 ORDER BY code',
    [stationId]
  );
  return rows;
}

export async function getCategory(id: string): Promise<Category | null> {
  const { rows } = await getPool().query<Category>(
    'SELECT * FROM categories WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function getCategoryByCode(stationId: string, code: string): Promise<Category | null> {
  const { rows } = await getPool().query<Category>(
    'SELECT * FROM categories WHERE station_id = $1 AND code = $2',
    [stationId, code]
  );
  return rows[0] ?? null;
}

export async function createCategory(data: {
  station_id: string;
  code: string;
  label: string;
  rotation_weight?: number;
  color_tag?: string;
}): Promise<Category> {
  const { rows } = await getPool().query<Category>(
    `INSERT INTO categories (station_id, code, label, rotation_weight, color_tag)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.station_id, data.code, data.label, data.rotation_weight ?? 1.0, data.color_tag ?? null]
  );
  return rows[0];
}

export async function upsertCategory(data: {
  station_id: string;
  code: string;
  label: string;
  rotation_weight?: number;
}): Promise<Category> {
  const { rows } = await getPool().query<Category>(
    `INSERT INTO categories (station_id, code, label, rotation_weight)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (station_id, code)
     DO UPDATE SET label = EXCLUDED.label, rotation_weight = EXCLUDED.rotation_weight
     RETURNING *`,
    [data.station_id, data.code, data.label, data.rotation_weight ?? 1.0]
  );
  return rows[0];
}

export async function updateCategory(id: string, data: Partial<{
  label: string;
  rotation_weight: number;
  color_tag: string;
  is_active: boolean;
}>): Promise<Category | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const allowed = ['label', 'rotation_weight', 'color_tag', 'is_active'] as const;
  for (const key of allowed) {
    if (data[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(data[key]); }
  }
  if (!fields.length) return getCategory(id);
  values.push(id);
  const { rows } = await getPool().query<Category>(
    `UPDATE categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteCategory(id: string): Promise<{ deleted: boolean; hasSongs: boolean }> {
  const { rows } = await getPool().query(
    'SELECT COUNT(*) FROM songs WHERE category_id = $1 AND is_active = TRUE',
    [id]
  );
  if (parseInt(rows[0].count, 10) > 0) {
    return { deleted: false, hasSongs: true };
  }
  const { rowCount } = await getPool().query('DELETE FROM categories WHERE id = $1', [id]);
  return { deleted: (rowCount ?? 0) > 0, hasSongs: false };
}
