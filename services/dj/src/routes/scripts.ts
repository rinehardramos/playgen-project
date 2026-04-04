import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@playgen/middleware';
import * as scriptService from '../services/scriptService.js';
import { getDefaultProfile } from '../services/profileService.js';
import { enqueueDjGeneration } from '../queues/djQueue.js';
import type { ReviewScriptRequest, GenerateScriptRequest } from '@playgen/types';
import { getPool } from '../db.js';

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Get the DJ script for a playlist (latest version)
  app.get<{ Params: { playlistId: string } }>(
    '/dj/playlists/:playlistId/script',
    async (req, reply) => {
      const script = await scriptService.getScript(req.params.playlistId);
      if (!script) return reply.notFound('No script found for this playlist');
      return script;
    },
  );

  // Trigger script generation for a playlist
  app.post<{ Params: { playlistId: string }; Body: GenerateScriptRequest }>(
    '/dj/playlists/:playlistId/generate',
    async (req, reply) => {
      const { station_id } = req.body as any;
      const { playlistId } = req.params;

      // Look up station to check auto_approve flag
      const { rows } = await getPool().query(
        `SELECT s.id, s.company_id, s.dj_auto_approve, s.dj_enabled
         FROM playlists p
         JOIN stations s ON s.id = p.station_id
         WHERE p.id = $1`,
        [playlistId],
      );
      const station = rows[0];
      if (!station) return reply.notFound('Playlist or station not found');
      if (!station.dj_enabled) return reply.badRequest('DJ is not enabled for this station');

      // Resolve DJ profile
      let dj_profile_id = req.body.dj_profile_id ?? null;
      if (!dj_profile_id) {
        const defaultProfile = await getDefaultProfile(station.company_id);
        if (!defaultProfile) return reply.badRequest('No DJ profile configured for this station');
        dj_profile_id = defaultProfile.id;
      }

      const jobId = await enqueueDjGeneration({
        playlist_id: playlistId,
        station_id: station.id,
        dj_profile_id,
        auto_approve: station.dj_auto_approve,
      });

      return reply.code(202).send({ job_id: jobId, status: 'queued' });
    },
  );

  // Review: approve / reject / edit
  app.post<{ Params: { id: string }; Body: ReviewScriptRequest }>(
    '/dj/scripts/:id/review',
    async (req, reply) => {
      const { id } = req.params;
      const { action, review_notes, edited_segments } = req.body;
      const user_id: string = (req as any).user.sub;

      if (action === 'approve') {
        const script = await scriptService.approveScript(id, user_id, review_notes);
        if (!script) return reply.badRequest('Script not found or not in pending_review state');
        return script;
      }

      if (action === 'reject') {
        if (!review_notes) return reply.badRequest('review_notes required when rejecting');
        const script = await scriptService.rejectScript(id, user_id, review_notes);
        if (!script) return reply.badRequest('Script not found or already finalized');

        // Re-queue generation so LLM rewrites based on the rejection notes
        const { rows } = await getPool().query(
          `SELECT playlist_id, station_id, dj_profile_id FROM dj_scripts WHERE id = $1`,
          [id],
        );
        if (rows[0]) {
          await enqueueDjGeneration({
            playlist_id: rows[0].playlist_id,
            station_id: rows[0].station_id,
            dj_profile_id: rows[0].dj_profile_id,
            auto_approve: false,
            rejection_notes: review_notes,
          });
        }
        return script;
      }

      if (action === 'edit') {
        if (!edited_segments?.length) return reply.badRequest('edited_segments required for edit action');
        await scriptService.editSegments(id, edited_segments);
        return scriptService.getScriptById(id);
      }

      return reply.badRequest('Invalid action');
    },
  );
}
