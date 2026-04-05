import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import * as scriptService from '../services/scriptService.js';
import * as manifestService from '../services/manifestService.js';
import { getDefaultProfile } from '../services/profileService.js';
import { enqueueDjGeneration } from '../queues/djQueue.js';
import { generateSegmentTts, loadTtsProviderConfig } from '../services/ttsService.js';
import type { ReviewScriptRequest, GenerateScriptRequest } from '@playgen/types';
import { getPool } from '../db.js';
import { getStorageAdapter } from '../lib/storage/index.js';

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // Get segment audio stream
  app.get<{ Params: { id: string } }>(
    '/dj/segments/:id/audio',
    async (req, reply) => {
      const { id } = req.params;
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT audio_url FROM dj_segments WHERE id = $1`,
        [id],
      );
      const segment = rows[0];
      if (!segment?.audio_url) return reply.notFound('Audio not found for this segment');

      // The audio_url is like "/api/v1/dj/audio/company-1/station-1/..."
      // We need the relative path after "/api/v1/dj/audio/"
      const prefix = '/api/v1/dj/audio/';
      if (!segment.audio_url.startsWith(prefix)) {
        return reply.badRequest('Invalid audio URL format');
      }

      const relativePath = segment.audio_url.substring(prefix.length);
      const storage = getStorageAdapter();
      
      try {
        const buffer = await storage.read(relativePath);
        return reply.type('audio/mpeg').send(buffer);
      } catch (err) {
        return reply.notFound('Audio file not found on storage');
      }
    },
  );

  // Get the DJ script for a playlist (latest version)
  app.get<{ Params: { playlistId: string } }>(
    '/dj/playlists/:playlistId/script',
    async (req, reply) => {
      const script = await scriptService.getScript(req.params.playlistId);
      if (!script) return reply.notFound('No script found for this playlist');
      return script;
    },
  );

  // Get show manifest (ordered playback list)
  app.get<{ Params: { id: string } }>(
    '/dj/scripts/:id/manifest',
    async (req, reply) => {
      const { id } = req.params;
      const manifestRow = await manifestService.getManifestByScript(id);
      if (!manifestRow?.manifest_url) return reply.notFound('Manifest not found');

      // Extract path from URL: /api/v1/dj/audio/...
      const prefix = '/api/v1/dj/audio/';
      if (!manifestRow.manifest_url.startsWith(prefix)) {
        return reply.badRequest('Invalid manifest URL format');
      }

      const relativePath = manifestRow.manifest_url.substring(prefix.length);
      const storage = getStorageAdapter();
      
      try {
        const buffer = await storage.read(relativePath);
        return reply.type('application/json').send(buffer);
      } catch (err) {
        return reply.notFound('Manifest file not found on storage');
      }
    },
  );

  // Trigger script generation for a playlist
  app.post<{ Params: { playlistId: string }; Body: GenerateScriptRequest }>(
    '/dj/playlists/:playlistId/generate',
    async (req, reply) => {
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
      let dj_profile_id = (req.body as any).dj_profile_id ?? null;
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
      const { action, review_notes, edited_segments } = req.body as any;
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

  // Regenerate TTS audio for a single segment
  app.post<{ Params: { segmentId: string } }>(
    '/dj/segments/:segmentId/regenerate-tts',
    async (req, reply) => {
      const { segmentId } = req.params;
      const pool = getPool();

      // Fetch segment + join to verify ownership via company
      const { rows: segRows } = await pool.query(
        `SELECT
           seg.id,
           seg.script_id,
           seg.position,
           seg.script_text,
           seg.edited_text,
           scr.station_id,
           st.company_id,
           dp.tts_voice_id
         FROM dj_segments seg
         JOIN dj_scripts scr ON scr.id = seg.script_id
         JOIN stations st ON st.id = scr.station_id
         LEFT JOIN dj_profiles dp ON dp.id = scr.dj_profile_id
         WHERE seg.id = $1`,
        [segmentId],
      );

      const seg = segRows[0];
      if (!seg) return reply.notFound('Segment not found');

      // Verify the calling user belongs to the same company as the station
      const userId: string = (req as any).user.sub;
      const { rows: userRows } = await pool.query(
        `SELECT company_id FROM users WHERE id = $1`,
        [userId],
      );
      const userCompanyId = userRows[0]?.company_id;
      if (!userCompanyId || userCompanyId !== seg.company_id) {
        return reply.forbidden('Access denied');
      }

      // Resolve TTS config: station settings override env vars
      const fallbackVoiceId = seg.tts_voice_id ?? 'alloy';
      const providerCfg = await loadTtsProviderConfig(seg.station_id, fallbackVoiceId);
      if (!providerCfg) {
        return reply.badRequest('TTS is not configured for this station');
      }

      // Use edited_text if present, otherwise fall back to script_text
      const textToSynth: string = seg.edited_text ?? seg.script_text;

      try {
        const { audio_url, audio_duration_sec } = await generateSegmentTts(
          {
            id: seg.id,
            position: seg.position,
            text: textToSynth,
            script_id: seg.script_id,
          },
          providerCfg,
        );

        // Return the updated segment row
        const { rows: updatedRows } = await pool.query(
          `SELECT * FROM dj_segments WHERE id = $1`,
          [segmentId],
        );

        return { ...updatedRows[0], audio_url, audio_duration_sec };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'TTS generation failed';
        return reply.internalServerError(message);
      }
    },
  );
}
