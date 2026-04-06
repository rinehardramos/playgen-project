/**
 * DJ Usage API — aggregate cost tracking for LLM token usage and TTS character usage.
 * GET /api/v1/stations/:id/dj/usage?month=YYYY-MM
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import { getPool } from '../db.js';

interface UsageQuerystring {
  month?: string;
}

interface UsageParams {
  id: string;
}

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /**
   * GET /api/v1/stations/:id/dj/usage?month=YYYY-MM
   *
   * Returns aggregated LLM and TTS usage for the station in the specified month.
   * Defaults to the current calendar month when `month` is omitted.
   *
   * Response shape:
   * {
   *   "month": "2026-04",
   *   "llm": { "calls": 12, "total_tokens": 45000, "prompt_tokens": 30000, "completion_tokens": 15000, "cost_usd": 0.45 },
   *   "tts": { "calls": 8, "character_count": 3200, "cost_usd": 0.06 },
   *   "total_cost_usd": 0.51
   * }
   */
  app.get<{ Params: UsageParams; Querystring: UsageQuerystring }>(
    '/stations/:id/dj/usage',
    async (req, reply) => {
      const { id: stationId } = req.params;
      const { month } = req.query;

      // Validate and parse the month parameter (YYYY-MM)
      let monthStart: Date;
      let monthEnd: Date;

      if (month) {
        if (!/^\d{4}-\d{2}$/.test(month)) {
          return reply.badRequest('month must be in YYYY-MM format');
        }
        monthStart = new Date(`${month}-01T00:00:00Z`);
        if (isNaN(monthStart.getTime())) {
          return reply.badRequest('month is not a valid date');
        }
        // First day of the next month
        monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
      } else {
        // Default to current calendar month (UTC)
        const now = new Date();
        monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      }

      const displayMonth = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`;

      const pool = getPool();

      // Verify station exists and user has access (via company_id check in middleware)
      const { rows: stationRows } = await pool.query<{ id: string; company_id: string }>(
        `SELECT id, company_id FROM stations WHERE id = $1`,
        [stationId],
      );
      if (!stationRows[0]) {
        return reply.notFound('Station not found');
      }

      // Verify the requesting user belongs to the same company
      const userId: string = (req as unknown as { user: { sub: string } }).user.sub;
      const { rows: userRows } = await pool.query<{ company_id: string }>(
        `SELECT company_id FROM users WHERE id = $1`,
        [userId],
      );
      if (!userRows[0] || userRows[0].company_id !== stationRows[0].company_id) {
        return reply.forbidden('Access denied');
      }

      // Aggregate usage for the requested month
      const { rows } = await pool.query<{
        usage_type: string;
        calls: string;
        prompt_tokens: string | null;
        completion_tokens: string | null;
        total_tokens: string | null;
        character_count: string | null;
        cost_usd: string | null;
      }>(
        `SELECT
           usage_type,
           COUNT(*)                       AS calls,
           SUM(prompt_tokens)             AS prompt_tokens,
           SUM(completion_tokens)         AS completion_tokens,
           SUM(total_tokens)             AS total_tokens,
           SUM(character_count)           AS character_count,
           SUM(cost_usd)                  AS cost_usd
         FROM dj_usage_log
         WHERE station_id = $1
           AND created_at >= $2
           AND created_at <  $3
         GROUP BY usage_type`,
        [stationId, monthStart.toISOString(), monthEnd.toISOString()],
      );

      const llmRow = rows.find((r) => r.usage_type === 'llm');
      const ttsRow = rows.find((r) => r.usage_type === 'tts');

      const llmCost = llmRow?.cost_usd != null ? parseFloat(llmRow.cost_usd) : 0;
      const ttsCost = ttsRow?.cost_usd != null ? parseFloat(ttsRow.cost_usd) : 0;

      return {
        month: displayMonth,
        llm: {
          calls: llmRow ? parseInt(llmRow.calls, 10) : 0,
          prompt_tokens: llmRow?.prompt_tokens != null ? parseInt(llmRow.prompt_tokens, 10) : 0,
          completion_tokens: llmRow?.completion_tokens != null ? parseInt(llmRow.completion_tokens, 10) : 0,
          total_tokens: llmRow?.total_tokens != null ? parseInt(llmRow.total_tokens, 10) : 0,
          cost_usd: parseFloat(llmCost.toFixed(6)),
        },
        tts: {
          calls: ttsRow ? parseInt(ttsRow.calls, 10) : 0,
          character_count: ttsRow?.character_count != null ? parseInt(ttsRow.character_count, 10) : 0,
          cost_usd: parseFloat(ttsCost.toFixed(6)),
        },
        total_cost_usd: parseFloat((llmCost + ttsCost).toFixed(6)),
      };
    },
  );
}
