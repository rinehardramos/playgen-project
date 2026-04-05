import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import { getPool } from '../db';
import type {
  Program,
  ProgramEpisode,
  CreateProgramRequest,
  CreateEpisodeRequest,
} from '@playgen/types';

export async function programRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // ── Programs ──────────────────────────────────────────────────────────────

  app.get<{ Params: { station_id: string } }>(
    '/stations/:station_id/programs',
    { onRequest: [requirePermission('station:read'), requireStationAccess()] },
    async (req) => {
      const { station_id } = req.params;
      const { rows } = await getPool().query<Program>(
        `SELECT * FROM programs WHERE station_id = $1 ORDER BY name`,
        [station_id],
      );
      return rows;
    },
  );

  app.get<{ Params: { station_id: string; id: string } }>(
    '/stations/:station_id/programs/:id',
    { onRequest: [requirePermission('station:read'), requireStationAccess()] },
    async (req, reply) => {
      const { id, station_id } = req.params;
      const { rows } = await getPool().query<Program>(
        `SELECT * FROM programs WHERE id = $1 AND station_id = $2`,
        [id, station_id],
      );
      if (!rows[0]) return reply.notFound('Program not found');
      return rows[0];
    },
  );

  app.post<{ Params: { station_id: string }; Body: CreateProgramRequest }>(
    '/stations/:station_id/programs',
    { onRequest: [requirePermission('station:write'), requireStationAccess()] },
    async (req, reply) => {
      const { station_id } = req.params;
      const { name, description, air_days, start_time, end_time, dj_profile_id, format_config, is_active } = req.body;
      if (!name?.trim()) return reply.badRequest('name is required');
      const { rows } = await getPool().query<Program>(
        `INSERT INTO programs (station_id, name, description, air_days, start_time, end_time, dj_profile_id, format_config, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [station_id, name.trim(), description ?? null, air_days ?? [], start_time ?? null, end_time ?? null,
         dj_profile_id ?? null, format_config ? JSON.stringify(format_config) : null, is_active ?? true],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  app.put<{ Params: { station_id: string; id: string }; Body: Partial<CreateProgramRequest> }>(
    '/stations/:station_id/programs/:id',
    { onRequest: [requirePermission('station:write'), requireStationAccess()] },
    async (req, reply) => {
      const { id, station_id } = req.params;
      const updates = req.body;
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      const allowed: Array<keyof CreateProgramRequest> = [
        'name', 'description', 'air_days', 'start_time', 'end_time', 'dj_profile_id', 'format_config', 'is_active',
      ];
      for (const key of allowed) {
        if (key in updates) {
          fields.push(`${key} = $${idx++}`);
          values.push(key === 'format_config' && updates[key] ? JSON.stringify(updates[key]) : updates[key] ?? null);
        }
      }
      if (fields.length === 0) return reply.badRequest('No fields to update');
      fields.push(`updated_at = NOW()`);
      values.push(id, station_id);
      const { rows } = await getPool().query<Program>(
        `UPDATE programs SET ${fields.join(', ')} WHERE id = $${idx} AND station_id = $${idx + 1} RETURNING *`,
        values,
      );
      if (!rows[0]) return reply.notFound('Program not found');
      return rows[0];
    },
  );

  app.delete<{ Params: { station_id: string; id: string } }>(
    '/stations/:station_id/programs/:id',
    { onRequest: [requirePermission('station:write'), requireStationAccess()] },
    async (req, reply) => {
      const { id, station_id } = req.params;
      const { rowCount } = await getPool().query(
        `DELETE FROM programs WHERE id = $1 AND station_id = $2`,
        [id, station_id],
      );
      if (!rowCount) return reply.notFound('Program not found');
      return reply.code(204).send();
    },
  );

  // ── Episodes ──────────────────────────────────────────────────────────────

  app.get<{ Params: { station_id: string; program_id: string }; Querystring: { limit?: string } }>(
    '/stations/:station_id/programs/:program_id/episodes',
    { onRequest: [requirePermission('station:read'), requireStationAccess()] },
    async (req, reply) => {
      const { program_id, station_id } = req.params;
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);
      const { rows: prog } = await getPool().query(
        `SELECT id FROM programs WHERE id = $1 AND station_id = $2`, [program_id, station_id],
      );
      if (!prog[0]) return reply.notFound('Program not found');
      const { rows } = await getPool().query<ProgramEpisode>(
        `SELECT * FROM program_episodes WHERE program_id = $1 ORDER BY air_date DESC LIMIT $2`,
        [program_id, limit],
      );
      return rows;
    },
  );

  app.get<{ Params: { station_id: string; program_id: string; id: string } }>(
    '/stations/:station_id/programs/:program_id/episodes/:id',
    { onRequest: [requirePermission('station:read'), requireStationAccess()] },
    async (req, reply) => {
      const { program_id, id, station_id } = req.params;
      const { rows: prog } = await getPool().query(
        `SELECT id FROM programs WHERE id = $1 AND station_id = $2`, [program_id, station_id],
      );
      if (!prog[0]) return reply.notFound('Program not found');
      const { rows } = await getPool().query<ProgramEpisode>(
        `SELECT * FROM program_episodes WHERE id = $1 AND program_id = $2`, [id, program_id],
      );
      if (!rows[0]) return reply.notFound('Episode not found');
      return rows[0];
    },
  );

  app.post<{ Params: { station_id: string; program_id: string }; Body: CreateEpisodeRequest }>(
    '/stations/:station_id/programs/:program_id/episodes',
    { onRequest: [requirePermission('station:write'), requireStationAccess()] },
    async (req, reply) => {
      const { program_id, station_id } = req.params;
      const { air_date, playlist_id, dj_script_id, notes } = req.body;
      if (!air_date) return reply.badRequest('air_date is required');
      const { rows: prog } = await getPool().query(
        `SELECT id FROM programs WHERE id = $1 AND station_id = $2`, [program_id, station_id],
      );
      if (!prog[0]) return reply.notFound('Program not found');
      const { rows } = await getPool().query<ProgramEpisode>(
        `INSERT INTO program_episodes (program_id, air_date, playlist_id, dj_script_id, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [program_id, air_date, playlist_id ?? null, dj_script_id ?? null, notes ?? null],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  app.patch<{
    Params: { station_id: string; program_id: string; id: string };
    Body: { status?: string; playlist_id?: string; dj_script_id?: string; manifest_id?: string; notes?: string };
  }>(
    '/stations/:station_id/programs/:program_id/episodes/:id',
    { onRequest: [requirePermission('station:write'), requireStationAccess()] },
    async (req, reply) => {
      const { program_id, id, station_id } = req.params;
      const { status, playlist_id, dj_script_id, manifest_id, notes } = req.body;
      const { rows: prog } = await getPool().query(
        `SELECT id FROM programs WHERE id = $1 AND station_id = $2`, [program_id, station_id],
      );
      if (!prog[0]) return reply.notFound('Program not found');
      const { rows } = await getPool().query<ProgramEpisode>(
        `UPDATE program_episodes
         SET status       = COALESCE($3::episode_status, status),
             playlist_id  = COALESCE($4, playlist_id),
             dj_script_id = COALESCE($5, dj_script_id),
             manifest_id  = COALESCE($6, manifest_id),
             notes        = COALESCE($7, notes),
             updated_at   = NOW()
         WHERE id = $1 AND program_id = $2 RETURNING *`,
        [id, program_id, status ?? null, playlist_id ?? null, dj_script_id ?? null, manifest_id ?? null, notes ?? null],
      );
      if (!rows[0]) return reply.notFound('Episode not found');
      return rows[0];
    },
  );
}
