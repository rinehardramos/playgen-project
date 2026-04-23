import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import * as scriptService from '../services/scriptService.js';
import * as manifestService from '../services/manifestService.js';
import { getDefaultProfile } from '../services/profileService.js';
import { enqueueDjGeneration, djQueue } from '../queues/djQueue.js';
import { generateSegmentTts, loadTtsProviderConfig } from '../services/ttsService.js';
import type { ReviewScriptRequest, GenerateScriptRequest } from '@playgen/types';
import { getPool } from '../db.js';
import { getStorageAdapter } from '../lib/storage/index.js';

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // ─── Job status endpoint ─────────────────────────────────────────────────

  // GET /dj/jobs/:jobId/status — poll BullMQ job state + progress
  app.get<{ Params: { jobId: string } }>(
    '/dj/jobs/:jobId/status',
    async (req, reply) => {
      const { jobId } = req.params;
      const job = await djQueue.getJob(jobId);
      if (!job) {
        return reply.notFound('Job not found');
      }

      const state = await job.getState();
      const progress = job.progress as { pct?: number; step?: string } | number | null;
      const pct = typeof progress === 'number' ? progress : (progress as { pct?: number })?.pct ?? 0;
      const step = typeof progress === 'object' && progress !== null ? (progress as { step?: string })?.step ?? '' : '';

      return {
        job_id: jobId,
        state,           // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown'
        pct,             // 0–100
        step,            // human-readable description of current step
        error: state === 'failed' ? (job.failedReason ?? 'Generation failed') : null,
        playlist_id: job.data.playlist_id,
      };
    },
  );

  // ─────────────────────────────────────────────────────────────────────────

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

  // Download full show audio — all segment audio files concatenated in order
  app.get<{ Params: { id: string } }>(
    '/dj/scripts/:id/audio',
    async (req, reply) => {
      const { id } = req.params;
      const company_id = req.user.cid;
      const pool = getPool();

      // Verify tenant ownership and get playlist date for the filename
      const { rows: scriptRows } = await pool.query<{ playlist_date: string; station_name: string }>(
        `SELECT pl.date::text AS playlist_date, st.name AS station_name
         FROM dj_scripts scr
         JOIN playlists pl ON pl.id = scr.playlist_id
         JOIN stations st ON st.id = scr.station_id
         WHERE scr.id = $1 AND st.company_id = $2`,
        [id, company_id],
      );
      if (!scriptRows[0]) return reply.notFound('Script not found');

      const { rows: segments } = await pool.query<{ position: number; audio_url: string | null }>(
        `SELECT position, audio_url FROM dj_segments WHERE script_id = $1 ORDER BY position`,
        [id],
      );

      const storage = getStorageAdapter();
      const prefix = '/api/v1/dj/audio/';
      const buffers: Buffer[] = [];

      for (const seg of segments) {
        if (!seg.audio_url) continue;
        const relativePath = seg.audio_url.startsWith(prefix)
          ? seg.audio_url.substring(prefix.length)
          : seg.audio_url;
        try {
          buffers.push(await storage.read(relativePath));
        } catch {
          // skip segments whose audio file is missing
        }
      }

      if (buffers.length === 0) return reply.notFound('No audio files found for this script');

      const combined = Buffer.concat(buffers);
      const safeDate = (scriptRows[0].playlist_date ?? 'show').replace(/[^0-9-]/g, '');
      const filename = `dj-show-${safeDate}.mp3`;

      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(combined);
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
      let dj_profile_id = (req.body as any)?.dj_profile_id ?? null;
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
        let job_id: string | null = null;
        if (rows[0]) {
          job_id = await enqueueDjGeneration({
            playlist_id: rows[0].playlist_id,
            station_id: rows[0].station_id,
            dj_profile_id: rows[0].dj_profile_id,
            auto_approve: false,
            rejection_notes: review_notes,
          });
        }
        return { ...script, job_id };
      }

      if (action === 'edit') {
        if (!edited_segments?.length) return reply.badRequest('edited_segments required for edit action');
        await scriptService.editSegments(id, edited_segments);
        return scriptService.getScriptById(id);
      }

      return reply.badRequest('Invalid action');
    },
  );

  // ─── Per-segment review endpoints (issue #31) ────────────────────────────

  // POST /dj/segments/:id/approve — mark single segment as approved
  app.post<{ Params: { id: string } }>(
    '/dj/segments/:id/approve',
    async (req, reply) => {
      const { id } = req.params;
      const updated = await scriptService.approveSegment(id);
      if (!updated) return reply.notFound('Segment not found');
      return updated;
    },
  );

  // POST /dj/segments/:id/reject — inline LLM rewrite for a single segment
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/dj/segments/:id/reject',
    async (req, reply) => {
      const { id } = req.params;
      const { reason } = req.body ?? {};
      try {
        const updated = await scriptService.regenerateSegment(id, reason);
        if (!updated) return reply.notFound('Segment not found or profile missing');
        return updated;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'LLM regeneration failed';
        req.log.error({ err }, '[reject] regenerateSegment failed');
        // Detect auth errors (401) and surface as 422; other LLM failures as 503
        const httpStatus = (err as any)?.status ?? (err as any)?.statusCode;
        if (httpStatus === 401 || /auth|api\.?key|unauthorized/i.test(message)) {
          return reply.code(422).send({ error: { code: 'LLM_AUTH_ERROR', message: 'LLM API key is invalid or not configured. Check station settings.' } });
        }
        return reply.code(503).send({ error: { code: 'LLM_UNAVAILABLE', message } });
      }
    },
  );

  // PUT /dj/segments/:id/text — save human-edited text for a single segment
  app.put<{ Params: { id: string }; Body: { text: string } }>(
    '/dj/segments/:id/text',
    async (req, reply) => {
      const { id } = req.params;
      const { text } = req.body ?? {} as { text: string };
      if (!text?.trim()) return reply.badRequest('text is required');
      const updated = await scriptService.saveSegmentEdit(id, text);
      if (!updated) return reply.notFound('Segment not found');
      return updated;
    },
  );

  // POST /dj/scripts/:id/approve — approve whole script (separate from /review action)
  app.post<{ Params: { id: string }; Body: { review_notes?: string } }>(
    '/dj/scripts/:id/approve',
    async (req, reply) => {
      const { id } = req.params;
      const { review_notes } = req.body ?? {};
      const userId: string = (req as any).user.sub;
      const script = await scriptService.approveScript(id, userId, review_notes);
      if (!script) return reply.badRequest('Script not found or not in pending_review state');
      return script;
    },
  );

  // POST /dj/scripts/:id/reject — reject whole script and re-queue LLM rewrite
  app.post<{ Params: { id: string }; Body: { review_notes: string } }>(
    '/dj/scripts/:id/reject',
    async (req, reply) => {
      const { id } = req.params;
      const { review_notes } = req.body ?? {} as { review_notes: string };
      const userId: string = (req as any).user.sub;

      if (!review_notes) return reply.badRequest('review_notes is required');

      const script = await scriptService.rejectScript(id, userId, review_notes);
      if (!script) return reply.badRequest('Script not found or already finalized');

      // Re-queue LLM rewrite with rejection context — return the job_id so the
      // frontend can poll /dj/jobs/:jobId/status for real progress and error details.
      const { rows } = await getPool().query(
        `SELECT playlist_id, station_id, dj_profile_id FROM dj_scripts WHERE id = $1`,
        [id],
      );
      let job_id: string | null = null;
      if (rows[0]) {
        job_id = await enqueueDjGeneration({
          playlist_id: rows[0].playlist_id,
          station_id: rows[0].station_id,
          dj_profile_id: rows[0].dj_profile_id,
          auto_approve: false,
          rejection_notes: review_notes,
        });
      }
      return { ...script, job_id };
    },
  );

  // ─────────────────────────────────────────────────────────────────────────

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
            station_id: seg.station_id,
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
        // Any 4xx from the TTS provider (bad voice, invalid model, bad key, quota, etc.) is
        // user-fixable — surface the real message as 400 Bad Request.
        const isProviderConfigError = /\b(400|401|403|429|quota|invalid.*key|key.*invalid|incorrect.*key|billing|Input should be)\b/i.test(message);
        if (isProviderConfigError) {
          return reply.badRequest(message);
        }
        return reply.internalServerError(message);
      }
    },
  );

  // DELETE /dj/segments/:id/audio — remove the generated TTS audio for a segment
  app.delete<{ Params: { id: string } }>(
    '/dj/segments/:id/audio',
    async (req, reply) => {
      const { id } = req.params;
      const pool = getPool();

      const { rows } = await pool.query<{ audio_url: string | null }>(
        `SELECT audio_url FROM dj_segments WHERE id = $1`,
        [id],
      );
      if (!rows[0]) return reply.notFound('Segment not found');

      if (rows[0].audio_url) {
        const prefix = '/api/v1/dj/audio/';
        const relativePath = rows[0].audio_url.startsWith(prefix)
          ? rows[0].audio_url.substring(prefix.length)
          : rows[0].audio_url;
        const storage = getStorageAdapter();
        await storage.delete(relativePath).catch(() => null);
      }

      const { rows: updated } = await pool.query(
        `UPDATE dj_segments
         SET audio_url = NULL, audio_duration_sec = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id],
      );
      return updated[0];
    },
  );
}
