import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'playgen',
      user: process.env.POSTGRES_USER ?? 'playgen',
      password: process.env.POSTGRES_PASSWORD ?? 'changeme',
      max: 10,
    });
    pool.on('error', (err) => console.error('pg pool error', err));
  }
  return pool;
}
