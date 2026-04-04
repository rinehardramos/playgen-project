import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import { DEFAULT_ROTATION_RULES, type RotationRules } from '@playgen/types';
import { getPool } from '../db';

interface StationParams {
  id: string;
}

const SECRET_KEYS = ['openai_api_key', 'elevenlabs_api_key', 'openrouter_api_key'] as const;

function maskSecrets<T extends Record<string, unknown>>(row: T): T {
  const masked = { ...row };
  for (const key of SECRET_KEYS) {
    if (key in masked) {
      (masked as Record<string, unknown>)[key] = masked[key] ? '***' : null;
    }
  }
  return masked;
}

export async function configRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /stations/:id/rotation-rules ──────────────────────────────────────
  app.get<{ Params: StationParams }>(
    '/stations/:id/rotation-rules',
    {
      preHandler: [
        authenticate,
        requirePermission('rules:read'),
        requireStationAccess(),
      ],
    },
    async (req: FastifyRequest<{ Params: StationParams }>, reply: FastifyReply) => {
      const stationId = req.params.id;
      const pool = getPool();

      const res = await pool.query<{ rules: RotationRules }>(
        'SELECT rules FROM rotation_rules WHERE station_id = $1',
        [stationId],
      );

      const rules: RotationRules = res.rows[0]?.rules ?? DEFAULT_ROTATION_RULES;
      return reply.code(200).send({ rules });
    },
  );

  // ── PUT /stations/:id/rotation-rules ──────────────────────────────────────
  app.put<{ Params: StationParams; Body: { rules: Partial<RotationRules> } }>(
    '/stations/:id/rotation-rules',
    {
      preHandler: [
        authenticate,
        requirePermission('rules:write'),
        requireStationAccess(),
      ],
    },
    async (req: FastifyRequest<{ Params: StationParams; Body: { rules: Partial<RotationRules> } }>, reply: FastifyReply) => {
      const stationId = req.params.id;
      const { rules } = req.body;
      const pool = getPool();

      const res = await pool.query<{ rules: RotationRules }>(
        `INSERT INTO rotation_rules (station_id, rules, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (station_id) DO UPDATE
           SET rules = EXCLUDED.rules,
               updated_at = NOW(),
               updated_by = EXCLUDED.updated_by
         RETURNING rules`,
        [stationId, JSON.stringify(rules), req.user.sub],
      );

      return reply.code(200).send({ rules: res.rows[0].rules });
    },
  );

  // ── GET /stations/:id/config ──────────────────────────────────────────────
  app.get<{ Params: StationParams }>(
    '/stations/:id/config',
    {
      preHandler: [
        authenticate,
        requirePermission('station:read'),
        requireStationAccess(),
      ],
    },
    async (req: FastifyRequest<{ Params: StationParams }>, reply: FastifyReply) => {
      const stationId = req.params.id;
      const pool = getPool();

      const res = await pool.query<{
        timezone: string;
        broadcast_start_hour: number;
        broadcast_end_hour: number;
        active_days: string[];
        openai_api_key?: string;
        elevenlabs_api_key?: string;
        openrouter_api_key?: string;
      }>(
        'SELECT timezone, broadcast_start_hour, broadcast_end_hour, active_days, openai_api_key, elevenlabs_api_key, openrouter_api_key FROM stations WHERE id = $1',
        [stationId],
      );

      if (!res.rows[0]) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Station not found' } });
      }

      return reply.code(200).send(maskSecrets(res.rows[0]));
    },
  );

  // ── PUT /stations/:id/config ──────────────────────────────────────────────
  app.put<{
    Params: StationParams;
    Body: {
      timezone?: string;
      broadcast_start_hour?: number;
      broadcast_end_hour?: number;
      active_days?: string[];
      openai_api_key?: string;
      elevenlabs_api_key?: string;
      openrouter_api_key?: string;
    };
  }>(
    '/stations/:id/config',
    {
      preHandler: [
        authenticate,
        requirePermission('station:write'),
        requireStationAccess(),
      ],
    },
    async (req: FastifyRequest<{
      Params: StationParams;
      Body: {
        timezone?: string;
        broadcast_start_hour?: number;
        broadcast_end_hour?: number;
        active_days?: string[];
        openai_api_key?: string;
        elevenlabs_api_key?: string;
        openrouter_api_key?: string;
      };
    }>, reply: FastifyReply) => {
      const stationId = req.params.id;
      const { 
        timezone, broadcast_start_hour, broadcast_end_hour, active_days,
        openai_api_key, elevenlabs_api_key, openrouter_api_key
      } = req.body;
      const pool = getPool();

      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if (timezone !== undefined) { fields.push(`timezone = $${i++}`); values.push(timezone); }
      if (broadcast_start_hour !== undefined) { fields.push(`broadcast_start_hour = $${i++}`); values.push(broadcast_start_hour); }
      if (broadcast_end_hour !== undefined) { fields.push(`broadcast_end_hour = $${i++}`); values.push(broadcast_end_hour); }
      if (active_days !== undefined) { fields.push(`active_days = $${i++}`); values.push(active_days); }
      if (openai_api_key !== undefined) { fields.push(`openai_api_key = $${i++}`); values.push(openai_api_key); }
      if (elevenlabs_api_key !== undefined) { fields.push(`elevenlabs_api_key = $${i++}`); values.push(elevenlabs_api_key); }
      if (openrouter_api_key !== undefined) { fields.push(`openrouter_api_key = $${i++}`); values.push(openrouter_api_key); }

      if (!fields.length) {
        const current = await pool.query(
          'SELECT timezone, broadcast_start_hour, broadcast_end_hour, active_days, openai_api_key, elevenlabs_api_key, openrouter_api_key FROM stations WHERE id = $1',
          [stationId],
        );
        return reply.code(200).send(maskSecrets(current.rows[0]));
      }

      fields.push('updated_at = NOW()');
      values.push(stationId);

      const res = await pool.query<{
        timezone: string;
        broadcast_start_hour: number;
        broadcast_end_hour: number;
        active_days: string[];
        openai_api_key?: string;
        elevenlabs_api_key?: string;
        openrouter_api_key?: string;
      }>(
        `UPDATE stations SET ${fields.join(', ')} WHERE id = $${i}
         RETURNING timezone, broadcast_start_hour, broadcast_end_hour, active_days, openai_api_key, elevenlabs_api_key, openrouter_api_key`,
        values,
      );

      if (!res.rows[0]) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Station not found' } });
      }

      return reply.code(200).send(maskSecrets(res.rows[0]));
    },
  );
}
