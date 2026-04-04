import { Pool } from 'pg';
import { config } from './config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (config.postgres.url) {
      const ssl = process.env.DATABASE_SSL === 'false'
        ? undefined
        : { rejectUnauthorized: false };
      pool = new Pool({ 
        connectionString: config.postgres.url, 
        ssl, 
        max: 10 
      });
    } else {
      pool = new Pool({
        host:     config.postgres.host,
        port:     config.postgres.port,
        database: config.postgres.db,
        user:     config.postgres.user,
        password: config.postgres.password,
        max: 10,
      });
    }
    pool.on('error', (err) => console.error('pg pool error', err));
  }
  return pool;
}
