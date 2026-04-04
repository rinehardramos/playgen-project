import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import * as playlistService from '../services/playlistService';
import { exportPlaylistXlsx, exportPlaylistCsv } from '../services/exportService';

export async function playlistRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  // GET /stations/:id/playlists — list playlists for a station
  app.get(
    '/stations/:id/playlists',
    { onRequest: [requirePermission('playlist:read'), requireStationAccess()] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { month } = req.query as { month?: string };

      try {
        const playlists = await playlistService.listPlaylists(id, { month });
        return playlists;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Bad request';
        return reply.code(400).send({ error: { code: 'BAD_REQUEST', message } });
      }
    }
  );

  // GET /playlists/:id — full playlist with entries
  app.get(
    '/playlists/:id',
    { onRequest: [requirePermission('playlist:read')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const playlist = await playlistService.getPlaylist(id);
      if (!playlist) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Playlist not found' } });
      }
      return playlist;
    }
  );

  // POST /playlists/:id/approve — approve playlist
  app.post(
    '/playlists/:id/approve',
    { onRequest: [requirePermission('playlist:write')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = req.user.sub;

      const playlist = await playlistService.approvePlaylist(id, userId);
      if (!playlist) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Playlist not found or not in an approvable state',
          },
        });
      }
      return playlist;
    }
  );

  // PUT /playlists/:id/notes — update notes
  app.put(
    '/playlists/:id/notes',
    { onRequest: [requirePermission('playlist:write')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { notes } = req.body as { notes: string };

      if (typeof notes !== 'string') {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'notes must be a string' } });
      }

      const playlist = await playlistService.updatePlaylistNotes(id, notes);
      if (!playlist) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Playlist not found' } });
      }
      return playlist;
    }
  );

  // PUT /playlists/:id/entries/:hour/:position — manual override entry
  app.put(
    '/playlists/:id/entries/:hour/:position',
    { onRequest: [requirePermission('playlist:write')] },
    async (req, reply) => {
      const { id, hour, position } = req.params as {
        id: string;
        hour: string;
        position: string;
      };
      const { song_id } = req.body as { song_id: string };

      if (typeof song_id !== 'string' || !song_id) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'song_id is required' } });
      }

      const hourNum = Number(hour);
      const posNum = Number(position);

      if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'hour must be an integer 0-23' } });
      }
      if (!Number.isInteger(posNum) || posNum < 0) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'position must be a non-negative integer' } });
      }

      const userId = req.user.sub;

      try {
        const entry = await playlistService.overrideEntry(id, hourNum, posNum, song_id, userId);
        return entry;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Override failed';
        return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message } });
      }
    }
  );

  // DELETE /playlists/:id/entries/:hour/:position/override — reset override flag
  app.delete(
    '/playlists/:id/entries/:hour/:position/override',
    { onRequest: [requirePermission('playlist:write')] },
    async (req, reply) => {
      const { id, hour, position } = req.params as {
        id: string;
        hour: string;
        position: string;
      };

      const hourNum = Number(hour);
      const posNum = Number(position);

      if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'hour must be an integer 0-23' } });
      }
      if (!Number.isInteger(posNum) || posNum < 0) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'position must be a non-negative integer' } });
      }

      const reset = await playlistService.resetEntry(id, hourNum, posNum);
      if (!reset) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Playlist entry not found' } });
      }
      return reply.code(204).send();
    }
  );

  // GET /playlists/:id/export/xlsx — export as Excel
  app.get(
    '/playlists/:id/export/xlsx',
    { onRequest: [requirePermission('playlist:export')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      let buffer: Buffer;
      try {
        buffer = await exportPlaylistXlsx(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Export failed';
        if (message.includes('not found')) {
          return reply.code(404).send({ error: { code: 'NOT_FOUND', message } });
        }
        return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message } });
      }

      // Fetch the playlist date for the filename
      const playlist = await playlistService.getPlaylist(id);
      const date = playlist?.date ?? id;

      reply.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      reply.header('Content-Disposition', `attachment; filename="playlist-${date}.xlsx"`);
      return reply.send(buffer);
    }
  );

  // GET /playlists/:id/export/csv — export as CSV
  app.get(
    '/playlists/:id/export/csv',
    { onRequest: [requirePermission('playlist:export')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      let csv: string;
      try {
        csv = await exportPlaylistCsv(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Export failed';
        if (message.includes('not found')) {
          return reply.code(404).send({ error: { code: 'NOT_FOUND', message } });
        }
        return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message } });
      }

      // Fetch the playlist date for the filename
      const playlist = await playlistService.getPlaylist(id);
      const date = playlist?.date ?? id;

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="playlist-${date}.csv"`);
      return reply.send(csv);
    }
  );

  // POST /playlists/:id/entries/:hour/:position/regen — regenerate one slot
  app.post(
    '/playlists/:id/entries/:hour/:position/regen',
    { onRequest: [requirePermission('playlist:write')] },
    async (req, reply) => {
      const { id, hour, position } = req.params as {
        id: string; hour: string; position: string;
      };

      const hourNum = Number(hour);
      const posNum = Number(position);

      if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'hour must be an integer 0-23' } });
      }
      if (!Number.isInteger(posNum) || posNum < 1 || posNum > 4) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'position must be an integer 1-4' } });
      }

      const userId = req.user.sub;

      try {
        const entry = await playlistService.regenEntry(id, hourNum, posNum, userId);
        if (!entry) {
          return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Playlist or entry not found' } });
        }
        return reply.code(200).send(entry);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Regen failed';
        return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message } });
      }
    }
  );
}
