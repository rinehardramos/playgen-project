import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import { getPool } from '../db';
import { enqueueGeneration } from '../services/queueService';
import { getDayOfWeek } from '../services/generationEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StationParams {
  stationId: string;
}

interface GenerateDayBody {
  date?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve today's date in the station's configured timezone.
 * Falls back to UTC if timezone is absent or invalid.
 */
export function todayInTimezone(timezone: string | null): string {
  const tz = timezone ?? 'UTC';
  try {
    // 'en-CA' locale produces ISO 8601 date strings (YYYY-MM-DD)
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function generateDayRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /stations/:stationId/generate-day
   *
   * Walk active programs for the target date and enqueue a generation job.
   * The generation engine is already clock-aware (programs.default_clock_id
   * overrides template slots per hour), so one job builds the full day log.
   *
   * Body:     { date?: "YYYY-MM-DD" }  — defaults to today in station timezone
   * Response: { job_id, programs_queued, playlist_ids, date }
   */
  app.post<{ Params: StationParams; Body: GenerateDayBody }>(
    '/stations/:stationId/generate-day',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: {
          type: 'object',
          required: ['stationId'],
          properties: {
            stationId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
          additionalProperties: false,
        },
      },
      preHandler: [
        authenticate,
        requirePermission('playlist:write'),
        requireStationAccess(),
      ],
    },
    async (
      req: FastifyRequest<{ Params: StationParams; Body: GenerateDayBody }>,
      reply: FastifyReply,
    ) => {
      const { stationId } = req.params;
      const userId = req.user.sub;
      const pool = getPool();

      // ── Step 1: Validate station + get timezone ───────────────────────────
      const stationRes = await pool.query<{ id: string; timezone: string | null }>(
        `SELECT id, timezone FROM stations WHERE id = $1`,
        [stationId],
      );

      if (stationRes.rows.length === 0) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Station not found' },
        });
      }

      const { timezone } = stationRes.rows[0];

      // ── Step 2: Resolve target date ───────────────────────────────────────
      const targetDate = req.body?.date ?? todayInTimezone(timezone);
      const dayOfWeek = getDayOfWeek(targetDate);

      // ── Step 3: Query active programs covering the target date ────────────
      const programsRes = await pool.query<{
        id: string;
        name: string;
        template_id: string | null;
      }>(
        `SELECT id, name, template_id
         FROM programs
         WHERE station_id = $1
           AND is_active = TRUE
           AND $2 = ANY(active_days)`,
        [stationId, dayOfWeek],
      );

      const programs = programsRes.rows;

      // No active programs for this day — return zero-queued (not an error)
      if (programs.length === 0) {
        return reply.code(200).send({
          job_id: null,
          programs_queued: 0,
          playlist_ids: [],
          date: targetDate,
          message: `No active programs found for ${dayOfWeek} (${targetDate})`,
        });
      }

      // ── Step 4: Guard against terminal / in-progress playlists ───────────
      const existingRes = await pool.query<{ status: string }>(
        `SELECT status FROM playlists WHERE station_id = $1 AND date = $2`,
        [stationId, targetDate],
      );

      if (existingRes.rows.length > 0) {
        const { status } = existingRes.rows[0];
        if (status === 'approved') {
          return reply.code(409).send({
            error: {
              code: 'CONFLICT',
              message: `Playlist for ${targetDate} is already approved`,
            },
          });
        }
        if (status === 'generating') {
          return reply.code(409).send({
            error: {
              code: 'CONFLICT',
              message: `Playlist for ${targetDate} is already being generated`,
            },
          });
        }
        // 'ready' or 'failed' — fall through and re-generate
      }

      // ── Step 5: Enqueue one generation job for this station + date ────────
      // The generation engine loads all active programs' clocks internally, so
      // one job covers all programs. No per-program enqueue is required.
      const templateId =
        programs.find((p) => p.template_id !== null)?.template_id ?? undefined;

      const jobId = await enqueueGeneration({
        stationId,
        date: targetDate,
        templateId,
        triggeredBy: 'manual',
        userId,
      });

      // ── Step 6: Collect any playlist id already present ──────────────────
      const playlistRes = await pool.query<{ id: string }>(
        `SELECT id FROM playlists WHERE station_id = $1 AND date = $2`,
        [stationId, targetDate],
      );
      const playlistIds = playlistRes.rows.map((r) => r.id);

      return reply.code(202).send({
        job_id: jobId,
        programs_queued: programs.length,
        playlist_ids: playlistIds,
        date: targetDate,
      });
    },
  );
}
