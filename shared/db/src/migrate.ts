import fs from 'fs';
import path from 'path';
import { getPool } from './client';
import { seedAdmin } from './seeds/admin';
import { seedDjPersona } from './seeds/djPersona';

async function migrate() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Widen legacy column if it was created as VARCHAR(10)
    await client.query(`ALTER TABLE schema_migrations ALTER COLUMN version TYPE VARCHAR(255)`);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Backfill: if a legacy row exists for "NNN" (3-char numeric), record the
    // alphabetically-first NNN_*.sql as the applied filename so we skip it
    // cleanly and still run any previously-colliding siblings.
    const legacyRows = await client.query(
      "SELECT version FROM schema_migrations WHERE version ~ '^[0-9]+$'"
    );
    for (const row of legacyRows.rows as Array<{ version: string }>) {
      const prefix = row.version;
      const match = files.find(f => f.startsWith(prefix + '_'));
      if (match) {
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
          [match]
        );
      }
    }

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const { rowCount } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [version]
      );
      if (rowCount && rowCount > 0) {
        console.log(`[skip] ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        );
        await client.query('COMMIT');
        console.log(`[done] ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('Migrations complete.');
    await seedAdmin(pool);
    await seedDjPersona(pool);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
