/**
 * Publish to Production pipeline — BullMQ queue + 4-stage worker.
 *
 * Stages (in order):
 *   1. validate        — script approved + all segments have local audio
 *   2. upload_assets   — upload MP3s to production R2; update segment audio_url with CDN URLs
 *   3. ingest_production — POST to prod /stations/ingest-external with CDN URLs
 *   4. trigger_playout — POST to prod /dj/scripts/:id/trigger-playout; returns stream_url
 *
 * Production notifies OwnRadio after trigger_playout (not the local pipeline's job).
 *
 * Required env vars:
 *   PROD_GATEWAY_URL      — e.g. https://api.playgen.site
 *   ACCESS_TOKEN          — prod JWT; auto-fetched via PROD_USERNAME/PROD_PASSWORD if absent
 *   PROD_USERNAME / PROD_PASSWORD — used to auto-refresh token when ACCESS_TOKEN is absent
 *   AWS_ACCESS_KEY_ID          — R2 write key (same creds used by production)
 *   AWS_SECRET_ACCESS_KEY
 *   S3_ENDPOINT                — R2 endpoint
 *   S3_BUCKET                  — R2 bucket
 *   S3_REGION                  — usually auto
 *   S3_PUBLIC_URL_BASE         — CDN base URL for uploaded assets
 *   REDIS_URL                  — BullMQ backing store
 */

import { Queue, Worker, type Job } from 'bullmq';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import { getPool } from '../db';

// ── Queue ──────────────────────────────────────────────────────────────────

export const PUBLISH_QUEUE = 'program-publish';

export interface PublishJobData {
  script_id: string;
  station_id: string;
  /** publish_jobs row ID — used to update stage state */
  publish_job_id: string;
}

export type PublishStage = 'validate' | 'upload_assets' | 'ingest_production' | 'trigger_playout';

let _queue: Queue<PublishJobData> | null = null;

export function getPublishQueue(): Queue<PublishJobData> {
  if (!_queue) {
    _queue = new Queue<PublishJobData>(PUBLISH_QUEUE, {
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
  }
  return _queue;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getProdToken(): Promise<string> {
  const token = process.env.ACCESS_TOKEN;
  if (token) return token;

  const gw = process.env.PROD_GATEWAY_URL ?? 'https://api.playgen.site';
  const email = process.env.PROD_USERNAME;
  const password = process.env.PROD_PASSWORD;
  if (!email || !password) {
    throw new Error('ACCESS_TOKEN or PROD_USERNAME + PROD_PASSWORD required');
  }

  const res = await fetch(`${gw}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Prod login failed: ${res.status}`);
  const data = await res.json() as { tokens?: { access_token: string }; access_token?: string };
  const tok = data.tokens?.access_token ?? data.access_token;
  if (!tok) throw new Error('Prod login response missing access_token');
  return tok;
}

function getS3Client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: false,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    },
  });
}

async function setStage(publishJobId: string, stage: PublishStage): Promise<void> {
  await getPool().query(
    `UPDATE publish_jobs SET current_stage = $1, status = 'running', updated_at = NOW()
     WHERE id = $2`,
    [stage, publishJobId],
  );
}

async function completeStage(publishJobId: string, stage: PublishStage): Promise<void> {
  await getPool().query(
    `UPDATE publish_jobs
     SET stages_completed = stages_completed || jsonb_build_object($1::text, 'ok'),
         updated_at = NOW()
     WHERE id = $2`,
    [stage, publishJobId],
  );
}

async function failJob(publishJobId: string, message: string): Promise<void> {
  await getPool().query(
    `UPDATE publish_jobs SET status = 'failed', error_message = $1, updated_at = NOW()
     WHERE id = $2`,
    [message, publishJobId],
  );
}

// ── Stage implementations ──────────────────────────────────────────────────

async function stageValidate(scriptId: string): Promise<void> {
  const pool = getPool();

  // Script must be approved
  const { rows: scriptRows } = await pool.query<{ review_status: string }>(
    `SELECT review_status FROM dj_scripts WHERE id = $1`,
    [scriptId],
  );
  const script = scriptRows[0];
  if (!script) throw new Error(`Script ${scriptId} not found`);
  if (!['approved', 'auto_approved'].includes(script.review_status)) {
    throw new Error(`Script not approved (status: ${script.review_status})`);
  }

  // All segments must have audio — either a CDN URL or a local file path
  const { rows: segs } = await pool.query<{ id: string; audio_url: string | null; position: number }>(
    `SELECT id, audio_url, position FROM dj_segments WHERE script_id = $1 ORDER BY position`,
    [scriptId],
  );
  if (segs.length === 0) throw new Error('Script has no segments');

  const missing: number[] = [];

  for (const seg of segs) {
    if (!seg.audio_url) { missing.push(seg.position); continue; }
    // CDN URL or DJ API path — both are considered valid (upload stage will fetch if needed)
    // Local file path check is skipped: the station service doesn't share storage with the DJ service
  }

  if (missing.length > 0) {
    throw new Error(
      `${missing.length} segment(s) missing audio (positions: ${missing.join(', ')}). ` +
      `Run POST /dj/scripts/${scriptId}/tts first.`,
    );
  }
}

async function fetchAudioBuffer(audioUrl: string): Promise<Buffer> {
  // DJ API path — fetch via DJ service URL (internal Docker network or gateway)
  if (audioUrl.startsWith('/api/v1/dj/')) {
    const djBase = process.env.DJ_INTERNAL_URL ?? 'http://dj:3007';
    const res = await fetch(`${djBase}${audioUrl}`);
    if (!res.ok) throw new Error(`Failed to fetch audio from DJ service (${res.status}): ${audioUrl}`);
    return Buffer.from(await res.arrayBuffer());
  }
  // Absolute local file path
  return fs.readFileSync(audioUrl);
}

async function stageUploadAssets(scriptId: string, stationSlug: string, playlistDate: string): Promise<void> {
  const pool = getPool();
  const s3 = getS3Client();
  const bucket = process.env.S3_BUCKET ?? '';
  const publicBase = (process.env.S3_PUBLIC_URL_BASE ?? '').replace(/\/$/, '');
  // NOTE: Audio files are fetched from the DJ service via HTTP, not from local disk.

  const { rows: segs } = await pool.query<{
    id: string; position: number; segment_type: string; audio_url: string | null;
  }>(
    `SELECT id, position, segment_type, audio_url FROM dj_segments WHERE script_id = $1 ORDER BY position`,
    [scriptId],
  );

  for (const seg of segs) {
    if (!seg.audio_url) continue;
    // Skip segments already on CDN
    if (seg.audio_url.startsWith('http')) continue;

    const s3Key = `programs/${stationSlug}/${playlistDate}/${seg.position}_${seg.segment_type}.mp3`;

    // Check if already uploaded (idempotent resume)
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
      // Already exists — update DB with CDN URL without re-uploading
      const cdnUrl = `${publicBase}/${s3Key}`;
      await pool.query(
        `UPDATE dj_segments SET audio_url = $1 WHERE id = $2`,
        [cdnUrl, seg.id],
      );
      continue;
    } catch {
      // Not found — proceed with upload
    }

    const body = await fetchAudioBuffer(seg.audio_url);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: body,
      ContentType: 'audio/mpeg',
    }));

    const cdnUrl = `${publicBase}/${s3Key}`;
    await pool.query(
      `UPDATE dj_segments SET audio_url = $1 WHERE id = $2`,
      [cdnUrl, seg.id],
    );
  }
}

async function stageIngestProduction(scriptId: string, token: string): Promise<string> {
  const pool = getPool();
  const gw = process.env.PROD_GATEWAY_URL ?? 'https://api.playgen.site';

  // Build the full ingest payload from local DB
  const { rows: scriptRows } = await pool.query<{
    id: string; station_id: string; playlist_id: string; dj_profile_id: string;
    review_status: string; llm_model: string; generation_source: string;
  }>(`SELECT * FROM dj_scripts WHERE id = $1`, [scriptId]);
  const script = scriptRows[0];
  if (!script) throw new Error('Script not found');

  const { rows: stRows } = await pool.query<{
    name: string; slug: string; timezone: string; locale_code: string | null;
    city: string | null; country_code: string | null; callsign: string | null;
    tagline: string | null; frequency: string | null;
  }>(`SELECT name, slug, timezone, locale_code, city, country_code, callsign, tagline, frequency
      FROM stations WHERE id = $1`, [script.station_id]);
  const station = stRows[0];
  if (!station) throw new Error('Station not found');

  const { rows: profRows } = await pool.query<{
    name: string; personality: string; voice_style: string;
    persona_config: Record<string, unknown>; llm_model: string;
    tts_provider: string; tts_voice_id: string;
  }>(`SELECT name, personality, voice_style, persona_config, llm_model, tts_provider, tts_voice_id
      FROM dj_profiles WHERE id = $1`, [script.dj_profile_id]);
  const profile = profRows[0];

  const { rows: plRows } = await pool.query<{ date: string }>(
    `SELECT date FROM playlists WHERE id = $1`, [script.playlist_id],
  );
  const playlist = plRows[0];
  if (!playlist) throw new Error('Playlist not found');

  const { rows: entries } = await pool.query<{
    hour: number; position: number; song_title: string; song_artist: string; duration_sec: number | null;
  }>(`SELECT pe.hour, pe.position, s.title AS song_title, s.artist AS song_artist, s.duration_sec
      FROM playlist_entries pe JOIN songs s ON s.id = pe.song_id
      WHERE pe.playlist_id = $1 ORDER BY pe.hour, pe.position`, [script.playlist_id]);

  const { rows: segments } = await pool.query<{
    segment_type: string; position: number; script_text: string;
    playlist_entry_id: string | null; audio_url: string | null; audio_duration_sec: number | null;
  }>(`SELECT segment_type, position, script_text, playlist_entry_id, audio_url, audio_duration_sec
      FROM dj_segments WHERE script_id = $1 ORDER BY position`, [scriptId]);

  // Build entry ID → index map
  const { rows: entryRows } = await pool.query<{ id: string }>(
    `SELECT id FROM playlist_entries WHERE playlist_id = $1 ORDER BY hour, position`,
    [script.playlist_id],
  );
  const entryIndexMap = new Map(entryRows.map((e, i) => [e.id, i]));

  const payload = {
    station: {
      slug: station.slug,
      name: station.name,
      timezone: station.timezone,
      locale_code: station.locale_code,
      city: station.city,
      country_code: station.country_code,
      callsign: station.callsign,
      tagline: station.tagline,
      frequency: station.frequency,
    },
    dj_profile: profile ? {
      name: profile.name,
      personality: profile.personality,
      voice_style: profile.voice_style,
      persona_config: profile.persona_config,
      llm_model: profile.llm_model,
      tts_provider: profile.tts_provider,
      tts_voice_id: profile.tts_voice_id,
    } : undefined,
    playlist: {
      date: playlist.date,
      entries: entries.map((e) => ({
        hour: e.hour,
        position: e.position,
        song_title: e.song_title,
        song_artist: e.song_artist,
        duration_sec: e.duration_sec,
      })),
    },
    script: {
      generation_source: script.generation_source,
      llm_model: script.llm_model,
      review_status: script.review_status,
      segments: segments.map((seg) => ({
        segment_type: seg.segment_type,
        position: seg.position,
        script_text: seg.script_text,
        playlist_entry_ref: seg.playlist_entry_id != null
          ? (entryIndexMap.get(seg.playlist_entry_id) ?? null)
          : null,
        audio_url: seg.audio_url,
        audio_duration_sec: seg.audio_duration_sec,
      })),
    },
  };

  const res = await fetch(`${gw}/api/v1/stations/ingest-external`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ingest failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { script_id: string };
  if (!data.script_id) throw new Error('Ingest response missing script_id');
  return data.script_id;
}

async function stageTriggerPlayout(prodScriptId: string, token: string): Promise<string> {
  const gw = process.env.PROD_GATEWAY_URL ?? 'https://api.playgen.site';

  const playoutUrl = `${gw}/api/v1/dj/scripts/${prodScriptId}/trigger-playout`;

  const res = await fetch(playoutUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`trigger-playout failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { stream_url?: string };
  return data.stream_url ?? `${gw}/stream/`;
}

// ── Worker ────────────────────────────────────────────────────────────────

export function startPublishWorker(): Worker<PublishJobData> {
  const worker = new Worker<PublishJobData>(
    PUBLISH_QUEUE,
    async (job: Job<PublishJobData>) => {
      const { script_id, publish_job_id } = job.data;
      const pool = getPool();

      // Read stages_completed to resume from last successful stage
      const { rows } = await pool.query<{ stages_completed: Record<string, string> }>(
        `SELECT stages_completed FROM publish_jobs WHERE id = $1`,
        [publish_job_id],
      );
      const done = rows[0]?.stages_completed ?? {};

      // Stage 1: validate
      if (!done.validate) {
        await setStage(publish_job_id, 'validate');
        await stageValidate(script_id);
        await completeStage(publish_job_id, 'validate');
      }

      // Resolve station slug + playlist date (needed for R2 key structure)
      const { rows: infoRows } = await pool.query<{ slug: string; playlist_date: string }>(
        `SELECT st.slug, pl.date AS playlist_date
         FROM dj_scripts sc
         JOIN stations st ON st.id = sc.station_id
         JOIN playlists pl ON pl.id = sc.playlist_id
         WHERE sc.id = $1`,
        [script_id],
      );
      const { slug, playlist_date } = infoRows[0];

      // Stage 2: upload_assets
      if (!done.upload_assets) {
        await setStage(publish_job_id, 'upload_assets');
        await stageUploadAssets(script_id, slug, playlist_date);
        await completeStage(publish_job_id, 'upload_assets');
      }

      // Fetch prod token (once, shared across remaining stages)
      const token = await getProdToken();

      // Stage 3: ingest_production
      if (!done.ingest_production) {
        await setStage(publish_job_id, 'ingest_production');
        const prodScriptId = await stageIngestProduction(script_id, token);
        // Persist prod_script_id alongside the stage completion so trigger_playout can use it
        await pool.query(
          `UPDATE publish_jobs
           SET stages_completed = stages_completed
               || jsonb_build_object('ingest_production', 'ok')
               || jsonb_build_object('prod_script_id', $1::text),
               updated_at = NOW()
           WHERE id = $2`,
          [prodScriptId, publish_job_id],
        );
      }

      // Re-read stages_completed to pick up prod_script_id
      const { rows: refreshed } = await pool.query<{ stages_completed: Record<string, string> }>(
        `SELECT stages_completed FROM publish_jobs WHERE id = $1`,
        [publish_job_id],
      );
      const doneRefreshed = refreshed[0]?.stages_completed ?? done;
      const prodScriptIdForPlayout = doneRefreshed.prod_script_id ?? '';

      // Stage 4: trigger_playout
      if (!doneRefreshed.trigger_playout) {
        if (!prodScriptIdForPlayout) throw new Error('prod_script_id missing — cannot trigger playout');
        await setStage(publish_job_id, 'trigger_playout');
        const streamUrl = await stageTriggerPlayout(prodScriptIdForPlayout, token);
        await completeStage(publish_job_id, 'trigger_playout');

        // Persist stream_url for the status endpoint
        await pool.query(
          `UPDATE publish_jobs
           SET stages_completed = stages_completed || jsonb_build_object('stream_url', $1::text),
               updated_at = NOW()
           WHERE id = $2`,
          [streamUrl, publish_job_id],
        );
      }

      // Mark complete
      await pool.query(
        `UPDATE publish_jobs SET status = 'completed', current_stage = NULL, updated_at = NOW()
         WHERE id = $1`,
        [publish_job_id],
      );
    },
    {
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
      concurrency: 1, // one publish job at a time across all stations
    },
  );

  worker.on('failed', async (job, err) => {
    if (job) {
      await failJob(job.data.publish_job_id, err.message).catch(() => {});
    }
  });

  return worker;
}
