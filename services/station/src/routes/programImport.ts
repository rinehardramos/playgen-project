import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@playgen/middleware';
import { importEpisode } from '../services/programImportService';

const MAX_BUNDLE_SIZE = 500 * 1024 * 1024; // 500 MB — DJ audio can be large

export async function programImportRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  /**
   * POST /programs/import
   * Accepts a multipart upload of a .playgen ZIP file.
   * Fields:
   *   - file        (required) — .playgen ZIP bundle
   *   - station_id  (required) — destination station UUID
   *   - auto_publish (optional) — 'true' to auto-publish the imported episode
   * Permission: program:write
   */
  app.post('/programs/import', {
    onRequest: [requirePermission('program:write')],
  }, async (req, reply) => {
    const user = (req as unknown as { user: { cid: string } }).user;
    const companyId = user.cid;

    let fileBuffer: Buffer | null = null;
    let stationId = '';
    let autoPublish = false;

    // Parse multipart
    const parts = req.parts({ limits: { fileSize: MAX_BUNDLE_SIZE } });

    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk as Buffer);
        }
        fileBuffer = Buffer.concat(chunks);
      } else {
        const value = (part as unknown as { value: string }).value;
        if (part.fieldname === 'station_id') stationId = value?.trim() ?? '';
        if (part.fieldname === 'auto_publish') autoPublish = value === 'true' || value === '1';
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.code(400).send({ error: { code: 'MISSING_FILE', message: 'A .playgen bundle file is required' } });
    }
    if (!stationId) {
      return reply.code(400).send({ error: { code: 'MISSING_STATION', message: 'station_id is required' } });
    }

    // Verify station belongs to caller's company (multi-tenant guard)
    const { getPool } = await import('../db');
    const pool = getPool();
    const { rowCount: stationCheck } = await pool.query(
      `SELECT 1 FROM stations WHERE id = $1 AND company_id = $2`,
      [stationId, companyId],
    );
    if (!stationCheck) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Station not found or access denied' } });
    }

    let result: { episodeId: string; warnings: string[] };
    try {
      result = await importEpisode(fileBuffer, stationId, companyId, { autoPublish });
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & { code?: string };
      if (e.code === 'INVALID_BUNDLE') {
        return reply.code(422).send({ error: { code: 'INVALID_BUNDLE', message: e.message } });
      }
      throw err;
    }

    return reply.code(201).send({
      episode_id: result.episodeId,
      warnings: result.warnings,
    });
  });
}
