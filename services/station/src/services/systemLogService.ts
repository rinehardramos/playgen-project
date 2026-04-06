import type { Pool } from 'pg';
import type { SystemLogLevel, SystemLogCategory, SystemLogEntry } from '@playgen/types';

export interface WriteLogOptions {
  level: SystemLogLevel;
  category: SystemLogCategory;
  message: string;
  company_id?: string | null;
  station_id?: string | null;
  user_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListLogsOptions {
  company_id: string;
  level?: SystemLogLevel;
  category?: SystemLogCategory;
  station_id?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/**
 * Fire-and-forget log write. A failure here must never break the calling flow.
 * Callers do NOT await this function.
 */
export function writeLog(pool: Pool, opts: WriteLogOptions): void {
  pool
    .query(
      `INSERT INTO system_logs (level, category, company_id, station_id, user_id, message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        opts.level,
        opts.category,
        opts.company_id ?? null,
        opts.station_id ?? null,
        opts.user_id ?? null,
        opts.message,
        opts.metadata ? JSON.stringify(opts.metadata) : null,
      ],
    )
    .catch((err: unknown) => {
      console.error('[log-write-failed]', err);
    });
}

export interface LogsPage {
  data: SystemLogEntry[];
  total: number;
  page: number;
  pages: number;
}

export async function listLogs(pool: Pool, opts: ListLogsOptions): Promise<LogsPage> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['company_id = $1'];
  const params: unknown[] = [opts.company_id];
  let idx = 2;

  if (opts.level) {
    conditions.push(`level = $${idx++}`);
    params.push(opts.level);
  }
  if (opts.category) {
    conditions.push(`category = $${idx++}`);
    params.push(opts.category);
  }
  if (opts.station_id) {
    conditions.push(`station_id = $${idx++}`);
    params.push(opts.station_id);
  }
  if (opts.from) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(opts.from);
  }
  if (opts.to) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(opts.to);
  }

  const where = conditions.join(' AND ');

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM system_logs WHERE ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataResult = await pool.query<SystemLogEntry>(
    `SELECT id, created_at, level, category, company_id, station_id, user_id, message, metadata
     FROM system_logs
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  return {
    data: dataResult.rows,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

/** Purge logs older than 90 days for a specific company.
 *  Scoped to company_id to prevent cross-tenant data deletion. */
export async function purgeOldLogs(pool: Pool, companyId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM system_logs
       WHERE company_id = $1 AND created_at < NOW() - INTERVAL '90 days'
       RETURNING id
     ) SELECT COUNT(*) AS count FROM deleted`,
    [companyId],
  );
  return parseInt(result.rows[0].count, 10);
}
