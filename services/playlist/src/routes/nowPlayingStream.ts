/**
 * GET /api/v1/playlists/now-playing/stream
 *
 * Server-Sent Events endpoint that emits the current-hour playlist slot
 * once immediately and then every 60 seconds.  Clients degrade to 60 s
 * polling when the browser cannot open an EventSource connection.
 *
 * Query params:
 *   stationId  (required) — UUID of the target station
 *   date       (optional) — ISO date YYYY-MM-DD, defaults to today
 *
 * Stream closes:
 *   - 2 hours after the connection is established (max TTL)
 *   - When the client disconnects
 *
 * Rate limit: 10 connections per minute per IP (generous for SSE).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '@playgen/middleware';
import { getPool } from '../db';

export interface NowPlayingRow {
  current_hour: number;
  playlist_id: string | null;
  status: string | null;
}

/** Exported for unit testing. */
export async function queryNowPlaying(stationId: string, date: string): Promise<NowPlayingRow> {
  const pool = getPool();
  const hour = new Date().getHours();

  const { rows } = await pool.query<{ playlist_id: string; status: string }>(
    `SELECT id AS playlist_id, status
     FROM playlists
     WHERE station_id = $1 AND date = $2
     LIMIT 1`,
    [stationId, date],
  );

  return {
    current_hour: hour,
    playlist_id: rows[0]?.playlist_id ?? null,
    status: rows[0]?.status ?? null,
  };
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function nowPlayingStreamRoutes(app: FastifyInstance) {
  app.get(
    '/playlists/now-playing/stream',
    {
      onRequest: [authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        querystring: {
          type: 'object',
          required: ['stationId'],
          properties: {
            stationId: { type: 'string' },
            date: { type: 'string' },
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { stationId, date: dateParam } = req.query as { stationId: string; date?: string };
      const date = dateParam ?? todayISO();

      // Validate date format if provided
      if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'date must be YYYY-MM-DD' } });
      }

      // Hijack the reply so Fastify doesn't auto-finalize the response.
      reply.hijack();
      const raw = reply.raw;

      // Set SSE headers
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
      raw.writeHead(200);

      const MAX_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

      function sendEvent(data: NowPlayingRow) {
        if (raw.destroyed || raw.writableEnded) return;
        raw.write(`data: ${JSON.stringify(data)}\n\n`);
      }

      function teardown() {
        clearInterval(interval);
        clearTimeout(maxTtlTimer);
        if (!raw.writableEnded) raw.end();
      }

      // Emit first event immediately
      try {
        const data = await queryNowPlaying(stationId, date);
        sendEvent(data);
      } catch (err) {
        app.log.error({ err, stationId }, '[sse] initial query failed');
        if (!raw.writableEnded) {
          raw.write(`event: error\ndata: {"code":"QUERY_ERROR"}\n\n`);
          raw.end();
        }
        return;
      }

      // Emit every 60 seconds
      const interval = setInterval(async () => {
        if (raw.destroyed || raw.writableEnded) {
          teardown();
          return;
        }
        try {
          const data = await queryNowPlaying(stationId, date);
          sendEvent(data);
        } catch (err) {
          app.log.error({ err, stationId }, '[sse] poll query failed — skipping tick');
        }
      }, 60_000);

      // Max TTL: close after 2 hours
      const maxTtlTimer = setTimeout(() => {
        if (!raw.writableEnded) {
          raw.write(`event: close\ndata: {"reason":"max_ttl"}\n\n`);
        }
        teardown();
      }, MAX_TTL_MS);

      // Clean up on client disconnect
      req.raw.on('close', teardown);
    },
  );
}
