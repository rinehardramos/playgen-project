import bcrypt from 'bcrypt';
import { getPool } from '../db';
import { User, ROLE_PERMISSIONS } from '@playgen/types';
import type { RoleCode } from '@playgen/types';

interface UserWithRole extends User {
  role_code: RoleCode;
  role_label: string;
}

export async function listUsers(companyId: string): Promise<UserWithRole[]> {
  const { rows } = await getPool().query<UserWithRole>(
    `SELECT u.*, r.code AS role_code, r.label AS role_label
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.company_id = $1 ORDER BY u.display_name`,
    [companyId]
  );
  return rows;
}

export async function getUser(id: string): Promise<UserWithRole | null> {
  const { rows } = await getPool().query<UserWithRole>(
    `SELECT u.*, r.code AS role_code, r.label AS role_label
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function createUser(data: {
  company_id: string;
  role_id: string;
  email: string;
  display_name: string;
  password: string;
  station_ids?: string[];
}): Promise<UserWithRole> {
  const password_hash = await bcrypt.hash(data.password, 12);
  const { rows } = await getPool().query<UserWithRole>(
    `WITH inserted AS (
       INSERT INTO users (company_id, role_id, email, display_name, password_hash, station_ids)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
     )
     SELECT i.*, r.code AS role_code, r.label AS role_label
     FROM inserted i JOIN roles r ON r.id = i.role_id`,
    [data.company_id, data.role_id, data.email.toLowerCase(), data.display_name, password_hash, data.station_ids ?? []]
  );
  return rows[0];
}

export async function updateUser(id: string, data: Partial<{
  role_id: string;
  display_name: string;
  station_ids: string[];
  is_active: boolean;
}>): Promise<UserWithRole | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const allowed = ['role_id','display_name','station_ids','is_active'] as const;
  for (const key of allowed) {
    if (data[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(data[key]); }
  }
  if (!fields.length) return getUser(id);
  fields.push('updated_at = NOW()');
  values.push(id);
  const { rows } = await getPool().query<UserWithRole>(
    `WITH updated AS (
       UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING *
     )
     SELECT u.*, r.code AS role_code, r.label AS role_label
     FROM updated u JOIN roles r ON r.id = u.role_id`,
    values
  );
  return rows[0] ?? null;
}

export async function deactivateUser(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

export async function resetUserPassword(id: string, newPassword: string): Promise<boolean> {
  const password_hash = await bcrypt.hash(newPassword, 12);
  const { rowCount } = await getPool().query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [password_hash, id]
  );
  return (rowCount ?? 0) > 0;
}

export async function listRoles(companyId: string) {
  const { rows } = await getPool().query(
    'SELECT * FROM roles WHERE company_id = $1 OR company_id IS NULL ORDER BY code',
    [companyId]
  );
  return rows;
}

export async function ensureCompanyRoles(companyId: string): Promise<void> {
  const defaultRoles: Array<{ code: RoleCode; label: string }> = [
    { code: 'company_admin', label: 'Company Admin' },
    { code: 'station_admin', label: 'Station Admin' },
    { code: 'scheduler', label: 'Scheduler' },
    { code: 'viewer', label: 'Viewer' },
  ];
  for (const role of defaultRoles) {
    await getPool().query(
      `INSERT INTO roles (company_id, code, label, permissions)
       VALUES ($1, $2, $3, $4) ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId, role.code, role.label, ROLE_PERMISSIONS[role.code]]
    );
  }
}
