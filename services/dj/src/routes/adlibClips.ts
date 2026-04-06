import { randomUUID } from 'crypto';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import { getPool } from '../db.js';
import { getStorageAdapter } from '../lib/storage/index.js';

const ALLOWED_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/ogg', 'audio/x-wav']);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

interface AdlibClipRow {
  id: string;
  station_id: string;
  name: string;
  audio_url: string;
  tags: string[];
  audio_duration_sec: string | null;
  file_size_bytes: number | null;
  original_filename: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function adlibClipRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // ── List adlib clips for a station ──────────────────────────────────────────
  app.get<{ Querystring: { station_id: string } }>(
    '/dj/adlib-clips',
    async (req, reply) => {
      const { station_id } = req.query;
      if (!station_id) return reply.badRequest('station_id query param is required');

      const user = (req as any).user;
      const pool = getPool();

      // Verify station belongs to caller's company
      const { rowCount: stationCheck } = await pool.query(
        `SELECT 1 FROM stations WHERE id = $1 AND company_id = $2`,
        [station_id, user.company_id],
      );
      if (!stationCheck) return reply.forbidden('Station not found or access denied');

      const { rows } = await pool.query<AdlibClipRow>(
        `SELECT id, station_id, name, audio_url, tags, audio_duration_sec,
                file_size_bytes, original_filename, created_at, updated_at
         FROM dj_adlib_clips
         WHERE station_id = $1
         ORDER BY created_at DESC`,
        [station_id],
      );
      return rows;
    },
  );

  // ── Upload a new adlib clip (multipart) ─────────────────────────────────────
  app.post(
    '/dj/adlib-clips',
    async (req, reply) => {
      const user = (req as any).user;
      const pool = getPool();
      const storage = getStorageAdapter();

      // Parse multipart
      const parts = req.parts({ limits: { fileSize: MAX_FILE_SIZE } });

      let fileData: Buffer | null = null;
      let originalFilename = '';
      let mimeType = '';
      let fileSizeBytes = 0;
      let clipName = '';
      let stationId = '';
      let tags: string[] = [];
      let audioDurationSec: number | null = null;

      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer);
          }
          fileData = Buffer.concat(chunks);
          fileSizeBytes = fileData.length;
          originalFilename = part.filename ?? 'upload';
          mimeType = part.mimetype ?? '';
        } else {
          // Text fields
          const value = (part as any).value as string;
          if (part.fieldname === 'name') clipName = value;
          if (part.fieldname === 'station_id') stationId = value;
          if (part.fieldname === 'tags') {
            try {
              tags = JSON.parse(value);
              if (!Array.isArray(tags)) tags = [];
            } catch {
              tags = value.split(',').map((t) => t.trim()).filter(Boolean);
            }
          }
          if (part.fieldname === 'audio_duration_sec') {
            const parsed = parseFloat(value);
            if (!isNaN(parsed) && parsed > 0) audioDurationSec = parsed;
          }
        }
      }

      if (!fileData) return reply.badRequest('Audio file is required');
      if (!clipName?.trim()) return reply.badRequest('name is required');
      if (!stationId) return reply.badRequest('station_id is required');

      // Validate mime type
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return reply.badRequest(`Unsupported audio format. Allowed: mp3, wav, ogg`);
      }

      // Verify station belongs to caller's company
      const { rowCount: stationCheck } = await pool.query(
        `SELECT 1 FROM stations WHERE id = $1 AND company_id = $2`,
        [stationId, user.company_id],
      );
      if (!stationCheck) return reply.forbidden('Station not found or access denied');

      // Derive extension and storage path
      const ext = path.extname(originalFilename).toLowerCase() || '.mp3';
      const clipId = randomUUID();
      const storagePath = `adlib-clips/${stationId}/${clipId}${ext}`;

      await storage.write(storagePath, fileData);
      const audioUrl = storage.getPublicUrl(storagePath);

      const { rows } = await pool.query<AdlibClipRow>(
        `INSERT INTO dj_adlib_clips
           (id, station_id, name, audio_url, tags, audio_duration_sec, file_size_bytes, original_filename)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          clipId,
          stationId,
          clipName.trim(),
          audioUrl,
          tags,
          audioDurationSec,
          fileSizeBytes,
          originalFilename,
        ],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  // ── Update clip name / tags ──────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: { name?: string; tags?: string[] } }>(
    '/dj/adlib-clips/:id',
    async (req, reply) => {
      const { id } = req.params;
      const { name, tags } = req.body ?? {};
      if (!name && !tags) return reply.badRequest('Provide name or tags to update');

      const user = (req as any).user;
      const pool = getPool();

      // Verify ownership via join
      const { rowCount, rows } = await pool.query<AdlibClipRow>(
        `UPDATE dj_adlib_clips c
         SET name = COALESCE($1, c.name),
             tags = COALESCE($2::text[], c.tags),
             updated_at = NOW()
         FROM stations s
         WHERE c.id = $3
           AND c.station_id = s.id
           AND s.company_id = $4
         RETURNING c.*`,
        [name?.trim() ?? null, tags ?? null, id, user.company_id],
      );
      if (!rowCount) return reply.notFound('Clip not found or access denied');
      return rows[0];
    },
  );

  // ── Delete clip ──────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/dj/adlib-clips/:id',
    async (req, reply) => {
      const { id } = req.params;
      const user = (req as any).user;
      const pool = getPool();
      const storage = getStorageAdapter();

      // Fetch clip to get audio_url for storage deletion
      const { rows, rowCount } = await pool.query<AdlibClipRow>(
        `SELECT c.* FROM dj_adlib_clips c
         JOIN stations s ON s.id = c.station_id
         WHERE c.id = $1 AND s.company_id = $2`,
        [id, user.company_id],
      );
      if (!rowCount) return reply.notFound('Clip not found or access denied');

      const clip = rows[0];

      // Derive storage path from audio_url (format: /api/v1/dj/audio/<path>)
      const urlPrefix = '/api/v1/dj/audio/';
      const storagePath = clip.audio_url.startsWith(urlPrefix)
        ? clip.audio_url.slice(urlPrefix.length)
        : null;

      // Delete from storage (soft fail if file missing)
      if (storagePath) {
        try { await storage.delete(storagePath); } catch { /* non-critical */ }
      }

      await pool.query('DELETE FROM dj_adlib_clips WHERE id = $1', [id]);
      return reply.code(204).send();
    },
  );
}
