import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import * as songService from '../services/songService';
import { importXlsmSongs, importXlsmLoadHistory } from '../services/importService';

export async function songRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  app.get('/stations/:id/songs', {
    onRequest: [requirePermission('library:read'), requireStationAccess()],
  }, async (req) => {
    const { id } = req.params as { id: string };
    const query = req.query as {
      category_id?: string;
      search?: string;
      is_active?: string;
      page?: string;
      limit?: string;
    };
    return songService.listSongs(id, {
      category_id: query.category_id,
      search: query.search,
      is_active: query.is_active !== undefined ? query.is_active === 'true' : undefined,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
  });

  app.post('/stations/:id/songs', {
    onRequest: [requirePermission('library:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      category_id: string;
      title: string;
      artist: string;
      duration_sec?: number;
      eligible_hours?: number[];
    };
    const song = await songService.createSong({ ...body, station_id: id, company_id: req.user.company_id });
    return reply.code(201).send(song);
  });

  app.get('/songs/:id', {
    onRequest: [requirePermission('library:read')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const song = await songService.getSong(id);
    if (!song) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Song not found' } });
    return song;
  });

  app.put('/songs/:id', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const song = await songService.updateSong(id, req.body as Parameters<typeof songService.updateSong>[1]);
    if (!song) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Song not found' } });
    return song;
  });

  app.delete('/songs/:id', {
    onRequest: [requirePermission('library:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deactivated = await songService.deactivateSong(id);
    if (!deactivated) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Song not found' } });
    return reply.code(204).send();
  });

  // ── Bulk import endpoint ────────────────────────────────────────────────────
  app.post('/stations/:id/songs/import', {
    onRequest: [requirePermission('library:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { format?: string; include_history?: string };

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });

    const ext = path.extname(data.filename).toLowerCase();
    if (!['.xlsm', '.xlsx'].includes(ext)) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Only .xlsm and .xlsx files are accepted' } });
    }

    // Write to a temp file (exceljs reads from disk)
    const tmpPath = path.join(os.tmpdir(), `playgen-import-${Date.now()}${ext}`);
    try {
      await pipeline(data.file, fs.createWriteStream(tmpPath));

      const result = await importXlsmSongs(tmpPath, id, req.user.company_id);

      if (query.include_history === 'true') {
        const historyResult = await importXlsmLoadHistory(tmpPath, id);
        return reply.code(200).send({ ...result, history: historyResult });
      }

      return reply.code(200).send(result);
    } finally {
      fs.unlink(tmpPath, () => {});
    }
  });
}
