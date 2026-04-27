import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import * as scriptService from '../services/scriptService.js';
import * as manifestService from '../services/manifestService.js';
import type { ProgramManifest, ShowManifest } from '../services/manifestService.js';
import { getDefaultProfile } from '../services/profileService.js';
import { enqueueDjGeneration, djQueue } from '../queues/djQueue.js';
import { generateSegmentTts, generateDialogueTts, isDialogueText, loadTtsProviderConfig } from '../services/ttsService.js';
import type { ReviewScriptRequest, GenerateScriptRequest } from '@playgen/types';
import { getPool } from '../db.js';
import { getStorageAdapter } from '../lib/storage/index.js';
import { generateHls } from '../playout/hlsGenerator.js';
import { getInfoBrokerClient } from '../lib/infoBroker.js';

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

      // Join to get company_id so we can reconstruct the storage path without
      // double-applying the S3 prefix that getPublicUrl() already includes.
      const { rows } = await getPool().query<{ station_id: string; company_id: string; manifest_url: string }>(
        `SELECT m.station_id, m.manifest_url, st.company_id
         FROM dj_show_manifests m
         JOIN dj_scripts s ON s.id = m.script_id
         JOIN stations st ON st.id = s.station_id
         WHERE m.script_id = $1`,
        [id],
      );
      const manifest = rows[0];
      if (!manifest?.manifest_url) return reply.notFound('Manifest not found');

      // Relative path matches what buildManifest() passed to storage.write()
      const relativePath = `${manifest.company_id}/${manifest.station_id}/${id}_manifest.json`;
      const storage = getStorageAdapter();
      try {
        const buffer = await storage.read(relativePath);
        return reply.type('application/json').send(buffer);
      } catch (err) {
        return reply.notFound('Manifest file not found on storage');
      }
    },
  );

  // Rebuild show manifest from current segment TTS audio
  app.post<{ Params: { id: string } }>(
    '/dj/scripts/:id/rebuild-manifest',
    async (req, reply) => {
      const { id } = req.params;
      try {
        await manifestService.buildManifest(id);
        const manifestRow = await manifestService.getManifestByScript(id);
        return { manifest_url: manifestRow?.manifest_url ?? null };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Manifest build failed';
        if (message.includes('not found')) return reply.notFound(message);
        req.log.error({ err }, '[rebuild-manifest] failed');
        return reply.internalServerError(message);
      }
    },
  );

  /**
   * Trigger playout for a script.
   *
   * CDN-backed path (preferred): if dj_segments already have R2 CDN audio_urls,
   * the playlist is served dynamically from the DB — no ffmpeg, no ephemeral disk.
   * Returns 200 synchronously with the stream URL and notifies OwnRadio.
   *
   * Legacy path: falls back to ffmpeg HLS generation from a ShowManifest.
   * Returns 202 immediately; generation runs in the background.
   */
  app.post<{ Params: { id: string } }>(
    '/dj/scripts/:id/trigger-playout',
    async (req, reply) => {
      const { id } = req.params;
      const GATEWAY_URL = process.env.GATEWAY_URL ?? 'https://api.playgen.site';
      const OWNRADIO_WEBHOOK_URL = process.env.OWNRADIO_WEBHOOK_URL ?? '';
      const PLAYGEN_WEBHOOK_SECRET = process.env.PLAYGEN_WEBHOOK_SECRET ?? '';

      // ── Check for CDN-backed segments ──────────────────────────────────────
      const { rows: cdnCheck } = await getPool().query<{
        station_id: string;
        cdn_count: string;
        total_count: string;
      }>(
        `SELECT sc.station_id,
                COUNT(*) FILTER (WHERE ds.audio_url LIKE 'http%') AS cdn_count,
                COUNT(*) AS total_count
         FROM dj_scripts sc
         JOIN dj_segments ds ON ds.script_id = sc.id
         WHERE sc.id = $1
         GROUP BY sc.station_id`,
        [id],
      );

      const row = cdnCheck[0];
      if (!row) return reply.notFound('Script not found');

      const streamUrl = `${GATEWAY_URL}/stream/${row.station_id}/playlist.m3u8`;
      const isCdnBacked = parseInt(row.cdn_count) > 0;

      if (isCdnBacked) {
        // ── CDN path: playlist served dynamically from DB, no ffmpeg ──────
        req.log.info(
          { scriptId: id, stationId: row.station_id, cdnSegments: row.cdn_count },
          '[trigger-playout] CDN-backed — serving from DB, skipping ffmpeg',
        );

        // Notify OwnRadio (fire-and-forget)
        if (OWNRADIO_WEBHOOK_URL) {
          const { rows: slugRows } = await getPool()
            .query<{ slug: string }>('SELECT slug FROM stations WHERE id = $1', [row.station_id])
            .catch(() => ({ rows: [] as { slug: string }[] }));
          const slug = slugRows[0]?.slug;
          if (slug) {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (PLAYGEN_WEBHOOK_SECRET) headers['X-PlayGen-Secret'] = PLAYGEN_WEBHOOK_SECRET;
            fetch(`${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/stream-control`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ action: 'url_change', streamUrl }),
            }).catch((err) => req.log.error({ err }, '[trigger-playout] webhook failed'));
            req.log.info({ slug, streamUrl }, '[trigger-playout] OwnRadio notified');
          }
        }

        return reply.code(200).send({ status: 'ready', stream_url: streamUrl, source: 'cdn' });
      }

      // ── Legacy path: ffmpeg HLS from ShowManifest ──────────────────────────
      const manifestRow = await manifestService.getManifestByScript(id);
      if (!manifestRow?.manifest_url) {
        return reply.badRequest('No CDN audio and no manifest URL — cannot trigger playout');
      }

      (async () => {
        try {
          const res = await fetch(manifestRow.manifest_url);
          if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
          const showManifest = await res.json() as ShowManifest;

          let cumulativeSec = 0;
          const segments: ProgramManifest['segments'] = showManifest.items.map((item, idx) => {
            const durationSec = item.duration_ms / 1000;
            const startSec = cumulativeSec;
            cumulativeSec += durationSec;
            return {
              position: idx,
              type: item.type,
              start_sec: startSec,
              duration_sec: durationSec,
              audio_url: item.file_path ?? null,
              metadata: { title: item.title ?? item.type, artist: item.artist ?? 'DJ' },
            };
          });

          const programManifest: ProgramManifest = {
            version: 1,
            station_id: row.station_id,
            episode_id: id,
            air_date: new Date().toISOString().slice(0, 10),
            total_duration_sec: cumulativeSec,
            segments,
          };

          const hls = await generateHls(row.station_id, programManifest);
          req.log.info({ stationId: row.station_id, segments: hls.totalSegments },
            '[trigger-playout] legacy HLS ready');

          if (OWNRADIO_WEBHOOK_URL) {
            const { rows: slugRows } = await getPool()
              .query<{ slug: string }>('SELECT slug FROM stations WHERE id = $1', [row.station_id])
              .catch(() => ({ rows: [] as { slug: string }[] }));
            const slug = slugRows[0]?.slug;
            if (slug) {
              const headers: Record<string, string> = { 'Content-Type': 'application/json' };
              if (PLAYGEN_WEBHOOK_SECRET) headers['X-PlayGen-Secret'] = PLAYGEN_WEBHOOK_SECRET;
              await fetch(`${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/stream-control`, {
                method: 'POST', headers,
                body: JSON.stringify({ action: 'url_change', streamUrl }),
              }).catch((err) => req.log.error({ err }, '[trigger-playout] webhook failed'));
            }
          }
        } catch (err) {
          req.log.error({ err }, '[trigger-playout] background HLS failed');
        }
      })();

      return reply.code(202).send({ status: 'generating', stream_url: streamUrl, source: 'ffmpeg' });
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
      const body = req.body as any;
      let dj_profile_id = body?.dj_profile_id ?? null;
      if (!dj_profile_id) {
        const defaultProfile = await getDefaultProfile(station.company_id);
        if (!defaultProfile) return reply.badRequest('No DJ profile configured for this station');
        dj_profile_id = defaultProfile.id;
      }

      const jobId = await enqueueDjGeneration({
        playlist_id: playlistId,
        station_id: station.id,
        dj_profile_id,
        auto_approve: body?.auto_approve ?? station.dj_auto_approve,
        secondary_dj_profile_id: body?.secondary_dj_profile_id ?? undefined,
        tertiary_dj_profile_id: body?.tertiary_dj_profile_id ?? undefined,
        voice_map: body?.voice_map ?? undefined,
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
        // Guard: reject approval if LLM generation hasn't produced segments yet (#419)
        const { rows: segCheck } = await getPool().query(
          'SELECT COUNT(*) AS cnt FROM dj_segments WHERE script_id = $1',
          [id],
        );
        if (parseInt(segCheck[0].cnt, 10) === 0) {
          return reply.badRequest('Script has no segments yet — LLM generation may still be in progress');
        }

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

  /**
   * POST /dj/scripts/:id/tts
   *
   * Generate TTS audio for all segments of a script that don't have audio yet.
   * Runs segments sequentially in the background; returns 202 immediately.
   *
   * Query params:
   *   ?force=true  — re-generate audio even for segments that already have an audio_url
   */
  app.post<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/dj/scripts/:id/tts',
    async (req, reply) => {
      const { id } = req.params;
      const force = req.query.force === 'true';
      const pool = getPool();

      // Verify script exists and is approved
      const { rows: scriptRows } = await pool.query<{
        id: string; station_id: string; review_status: string; dj_profile_id: string;
        voice_map: Record<string, string> | null;
      }>(
        `SELECT id, station_id, review_status, dj_profile_id, voice_map FROM dj_scripts WHERE id = $1`,
        [id],
      );
      const script = scriptRows[0];
      if (!script) return reply.notFound('Script not found');
      if (!['approved', 'auto_approved'].includes(script.review_status)) {
        return reply.badRequest(`Script must be approved before TTS (status: ${script.review_status})`);
      }

      // Load TTS config once for the station
      const { rows: profileRows } = await pool.query<{ tts_voice_id: string }>(
        `SELECT tts_voice_id FROM dj_profiles WHERE id = $1`,
        [script.dj_profile_id],
      );
      const fallbackVoiceId = profileRows[0]?.tts_voice_id ?? 'alloy';
      const providerCfg = await loadTtsProviderConfig(script.station_id, fallbackVoiceId);
      if (!providerCfg) {
        return reply.badRequest('TTS is not configured for this station');
      }

      // Fetch segments to process
      const { rows: segments } = await pool.query<{
        id: string; position: number; script_text: string;
        edited_text: string | null; audio_url: string | null;
        tts_voice_id: string | null;
      }>(
        `SELECT id, position, script_text, edited_text, audio_url, tts_voice_id
         FROM dj_segments WHERE script_id = $1 ORDER BY position`,
        [id],
      );

      const pending = force
        ? segments
        : segments.filter((s) => !s.audio_url);

      if (pending.length === 0) {
        return reply.code(200).send({
          status: 'already_complete',
          total: segments.length,
          generated: 0,
        });
      }

      // Fire-and-forget: run TTS in parallel batches (configurable concurrency)
      const concurrency = Math.max(1, parseInt(process.env.TTS_WORKER_CONCURRENCY ?? '3', 10));
      (async () => {
        let generated = 0;
        let failed = 0;
        for (let i = 0; i < pending.length; i += concurrency) {
          const batch = pending.slice(i, i + concurrency);
          const results = await Promise.allSettled(
            batch.map((seg) => {
              const text = seg.edited_text ?? seg.script_text;
              const segInput = {
                id: seg.id,
                position: seg.position,
                text,
                script_id: id,
                station_id: script.station_id,
              };
              // Dialogue segments: multi-voice TTS with ffmpeg concat
              if (script.voice_map && isDialogueText(text)) {
                return generateDialogueTts(segInput, providerCfg, script.voice_map);
              }
              // Per-segment voice override (single-speaker dual-DJ)
              const segCfg = seg.tts_voice_id
                ? { ...providerCfg, voiceId: seg.tts_voice_id }
                : providerCfg;
              return generateSegmentTts(segInput, segCfg);
            },
            ),
          );
          for (const result of results) {
            if (result.status === 'fulfilled') {
              generated++;
            } else {
              failed++;
              req.log.warn({ err: result.reason }, '[script-tts] segment TTS failed');
            }
          }
        }
        req.log.info({ scriptId: id, generated, failed, concurrency }, '[script-tts] TTS run complete');
      })();

      return reply.code(202).send({
        status: 'generating',
        total: segments.length,
        pending: pending.length,
      });
    },
  );

  // POST /dj/scripts/:id/approve — approve whole script (separate from /review action)
  app.post<{ Params: { id: string }; Body: { review_notes?: string } }>(
    '/dj/scripts/:id/approve',
    async (req, reply) => {
      const { id } = req.params;
      const { review_notes } = req.body ?? {};
      const userId: string = (req as any).user.sub;

      // Guard: reject approval if LLM generation hasn't produced segments yet (#419)
      const { rows: segCheck } = await getPool().query(
        'SELECT COUNT(*) AS cnt FROM dj_segments WHERE script_id = $1',
        [id],
      );
      if (parseInt(segCheck[0].cnt, 10) === 0) {
        return reply.badRequest('Script has no segments yet — LLM generation may still be in progress');
      }

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

  // ─── Out-of-band script generation support ───────────────────────────────
  //
  // These two routes allow an external agent (e.g. Claude Code) to:
  //   1. Fetch all the context needed to write a DJ script
  //   2. Submit the finished script segments back to PlayGen
  //
  // The generated script is stored with generation_source = 'external' so it
  // is distinguishable from scripts produced by the internal BullMQ LLM worker.

  // GET /dj/context/:playlist_id
  // Returns station, DJ profile, playlist tracks, and live data (weather/news)
  // so an external agent has everything needed to write a script.
  app.get<{ Params: { playlist_id: string } }>(
    '/dj/context/:playlist_id',
    async (req, reply) => {
      const pool = getPool();
      const { playlist_id } = req.params;

      // Resolve station from playlist
      const { rows: plRows } = await pool.query<{
        id: string; station_id: string; date: string;
      }>(
        `SELECT id, station_id, date FROM playlists WHERE id = $1`,
        [playlist_id],
      );
      const playlist = plRows[0];
      if (!playlist) return reply.notFound('Playlist not found');

      // Station info
      const { rows: stRows } = await pool.query<{
        id: string; name: string; timezone: string; locale_code: string | null;
        city: string | null; country_code: string | null;
        latitude: number | null; longitude: number | null;
        callsign: string | null; tagline: string | null; frequency: string | null;
        news_scope: string | null; news_topic: string | null;
      }>(
        `SELECT id, name, timezone, locale_code, city, country_code,
                latitude, longitude, callsign, tagline, frequency,
                news_scope, news_topic
         FROM stations WHERE id = $1`,
        [playlist.station_id],
      );
      const station = stRows[0];
      if (!station) return reply.notFound('Station not found');

      // DJ profile (default for station's company)
      const { rows: compRows } = await pool.query<{ company_id: string }>(
        `SELECT company_id FROM stations WHERE id = $1`,
        [playlist.station_id],
      );
      const profile = await getDefaultProfile(compRows[0]?.company_id ?? '');

      // Playlist tracks
      const { rows: tracks } = await pool.query<{
        id: string; hour: number; position: number;
        song_title: string; song_artist: string; duration_sec: number | null;
      }>(
        `SELECT pe.id, pe.hour, pe.position,
                s.title AS song_title, s.artist AS song_artist, s.duration_sec
         FROM playlist_entries pe
         JOIN songs s ON s.id = pe.song_id
         WHERE pe.playlist_id = $1
         ORDER BY pe.hour, pe.position`,
        [playlist_id],
      );

      // Weather + news via info-broker (soft-fail)
      let weather: unknown = null;
      let news: unknown = null;
      const broker = getInfoBrokerClient();
      if (broker) {
        const [w, n] = await Promise.allSettled([
          broker.getWeather({
            city: station.city ?? undefined,
            country_code: station.country_code ?? undefined,
            lat: station.latitude ?? undefined,
            lon: station.longitude ?? undefined,
          }),
          broker.getNews({
            scope: (station.news_scope as 'global' | 'country' | 'local') ?? 'global',
            topic: station.news_topic ?? 'any',
            country_code: station.country_code ?? undefined,
            limit: 10,
          }),
        ]);
        if (w.status === 'fulfilled') weather = w.value;
        if (n.status === 'fulfilled') news = n.value;
      }

      return {
        playlist_id,
        playlist_date: playlist.date,
        station: {
          id: station.id,
          name: station.name,
          timezone: station.timezone,
          locale_code: station.locale_code,
          city: station.city,
          country_code: station.country_code,
          callsign: station.callsign,
          tagline: station.tagline,
          frequency: station.frequency,
        },
        dj_profile: profile
          ? {
              id: profile.id,
              name: profile.name,
              personality: profile.personality,
              voice_style: profile.voice_style,
              backstory: profile.persona_config?.backstory ?? null,
              catchphrases: profile.persona_config?.catchphrases ?? [],
              signature_greeting: profile.persona_config?.signature_greeting ?? null,
            }
          : null,
        tracks,
        weather,
        news,
        current_time_utc: new Date().toISOString(),
      };
    },
  );

  // POST /dj/scripts/submit-external
  // Accept a script generated by an external agent (Claude Code) and persist it.
  // Body: { playlist_id, dj_profile_id?, auto_approve?, segments: ExternalSegment[] }
  interface ExternalSegment {
    segment_type: string;
    position: number;
    script_text: string;
    playlist_entry_id?: string | null;
    speaker?: string | null;
    tts_voice_id?: string | null;
  }
  interface SubmitExternalBody {
    playlist_id: string;
    dj_profile_id?: string;
    secondary_dj_profile_id?: string;
    auto_approve?: boolean;
    voice_map?: Record<string, string>;
    segments: ExternalSegment[];
  }

  app.post<{ Body: SubmitExternalBody }>(
    '/dj/scripts/submit-external',
    async (req, reply) => {
      const pool = getPool();
      const { playlist_id, dj_profile_id, secondary_dj_profile_id, auto_approve = false, voice_map, segments } = req.body;

      if (!playlist_id) return reply.badRequest('playlist_id is required');
      if (!Array.isArray(segments) || segments.length === 0) {
        return reply.badRequest('segments must be a non-empty array');
      }

      // Resolve station from playlist
      const { rows: plRows } = await pool.query<{ station_id: string }>(
        `SELECT station_id FROM playlists WHERE id = $1`,
        [playlist_id],
      );
      const playlist = plRows[0];
      if (!playlist) return reply.notFound('Playlist not found');

      // Resolve DJ profile
      let profileId = dj_profile_id;
      if (!profileId) {
        const { rows: compRows } = await pool.query<{ company_id: string }>(
          `SELECT company_id FROM stations WHERE id = $1`,
          [playlist.station_id],
        );
        const profile = await getDefaultProfile(compRows[0]?.company_id ?? '');
        profileId = profile?.id;
      }
      if (!profileId) return reply.badRequest('No DJ profile found for this station');

      const reviewStatus = auto_approve ? 'auto_approved' : 'pending_review';

      // Insert script record
      const { rows: scriptRows } = await pool.query<{ id: string }>(
        `INSERT INTO dj_scripts
           (playlist_id, station_id, dj_profile_id, secondary_dj_profile_id,
            review_status, llm_model, total_segments, generation_source, voice_map)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'external', $8)
         RETURNING id`,
        [playlist_id, playlist.station_id, profileId, secondary_dj_profile_id ?? null,
         reviewStatus, 'claude-code', segments.length, voice_map ? JSON.stringify(voice_map) : null],
      );
      const script_id = scriptRows[0].id;

      // Insert segments
      for (const seg of segments) {
        await pool.query(
          `INSERT INTO dj_segments
             (script_id, playlist_entry_id, segment_type, position, script_text,
              speaker, tts_voice_id, segment_review_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
          [
            script_id,
            seg.playlist_entry_id ?? null,
            seg.segment_type,
            seg.position,
            seg.script_text,
            seg.speaker ?? null,
            seg.tts_voice_id ?? null,
          ],
        );
      }

      reply.code(201);
      return { script_id, segment_count: segments.length, review_status: reviewStatus };
    },
  );
}
