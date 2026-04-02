import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@playgen.local';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'changeme';

export async function seedAdmin(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Idempotent: skip if admin already exists
    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [DEFAULT_ADMIN_EMAIL]
    );
    if (existing.rowCount && existing.rowCount > 0) {
      console.log('[seed] Admin user already exists, skipping.');
      return;
    }

    // Create default company if needed
    await client.query(
      `INSERT INTO companies (id, name, slug)
       VALUES ($1, 'PlayGen Radio', 'playgen')
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_COMPANY_ID]
    );

    // Get super_admin role (platform level — no company_id)
    const roleResult = await client.query(
      "SELECT id FROM roles WHERE code = 'super_admin' AND company_id IS NULL"
    );
    if (!roleResult.rows.length) {
      console.warn('[seed] super_admin role not found, skipping admin seed.');
      return;
    }
    const roleId = roleResult.rows[0].id as string;

    // Hash password
    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

    // Insert admin user
    await client.query(
      `INSERT INTO users (company_id, role_id, email, display_name, password_hash)
       VALUES ($1, $2, $3, 'Admin', $4)`,
      [DEFAULT_COMPANY_ID, roleId, DEFAULT_ADMIN_EMAIL, passwordHash]
    );

    console.log(`[seed] Default admin created: ${DEFAULT_ADMIN_EMAIL} / ${DEFAULT_ADMIN_PASSWORD}`);
  } finally {
    client.release();
  }
}
