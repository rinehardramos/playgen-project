import { getPool } from '../db';
import { Company } from '@playgen/types';

export async function listCompanies(): Promise<Company[]> {
  const { rows } = await getPool().query<Company>('SELECT * FROM companies ORDER BY name');
  return rows;
}

export async function getCompany(id: string): Promise<Company | null> {
  const { rows } = await getPool().query<Company>('SELECT * FROM companies WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function createCompany(data: { name: string; slug: string }): Promise<Company> {
  const { rows } = await getPool().query<Company>(
    `INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING *`,
    [data.name, data.slug]
  );
  return rows[0];
}

export async function updateCompany(id: string, data: Partial<{ name: string; slug: string }>): Promise<Company | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (data.name !== undefined) { fields.push(`name = $${i++}`); values.push(data.name); }
  if (data.slug !== undefined) { fields.push(`slug = $${i++}`); values.push(data.slug); }
  if (!fields.length) return getCompany(id);
  fields.push(`updated_at = NOW()`);
  values.push(id);
  const { rows } = await getPool().query<Company>(
    `UPDATE companies SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteCompany(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query('DELETE FROM companies WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
