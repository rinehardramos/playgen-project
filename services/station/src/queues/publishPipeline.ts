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
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getPool } from '../db';

const execFileAsync = promisify(execFile);

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

/**
 * Ask info-broker to source audio for songs missing audio_url, then poll the DB
 * until all songs have a URL or the timeout elapses. Uses SOURCING_CALLBACK_BASE
 * (default: PROD_GATEWAY_URL) for the callback so local dev can point at the
 * local gateway instead of production.
 *
 * Never throws — if env vars are missing or the request fails, sourcing is skipped.
 */
async function awaitSongSourcing(
  scriptId: string,
  stationId: string,
  songs: Array<{ song_id: string; title: string; artist: string }>,
): Promise<void> {
  if (songs.length === 0) return;

  const infoBrokerUrl = process.env.INFO_BROKER_URL;
  const apiKey = process.env.INFO_BROKER_API_KEY;
  if (!infoBrokerUrl || !apiKey) {
    console.warn('[awaitSongSourcing] INFO_BROKER_URL or INFO_BROKER_API_KEY not set — skipping audio sourcing');
    return;
  }

  // SOURCING_CALLBACK_BASE lets local dev point at the local gateway (http://gateway)
  // instead of PROD_GATEWAY_URL which targets production.
  const callbackBase = process.env.SOURCING_CALLBACK_BASE
    ?? process.env.PROD_GATEWAY_URL
    ?? 'https://api.playgen.site';

  try {
    await fetch(`${infoBrokerUrl}/v1/playlists/source-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        station_id: stationId,
        songs,
        callback_url: `${callbackBase}/api/v1/internal/songs/audio-sourced`,
      }),
    });
  } catch (err) {
    console.warn('[awaitSongSourcing] Failed to reach info-broker — skipping audio sourcing', err);
    return;
  }

  // Poll until all submitted songs have an audio_url or we time out.
  const timeoutMs = parseInt(process.env.SONG_SOURCING_TIMEOUT_SEC ?? '300', 10) * 1000;
  const pollMs = 10_000;
  const deadline = Date.now() + timeoutMs;
  const songIds = songs.map(s => s.song_id);

  console.info(`[awaitSongSourcing] Waiting up to ${timeoutMs / 1000}s for ${songs.length} song(s) to be sourced…`);

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT COUNT(*) FROM songs WHERE id = ANY($1) AND (audio_url IS NULL OR audio_url = '')`,
      [songIds],
    );
    const pending = parseInt(rows[0].count, 10);
    if (pending === 0) {
      console.info('[awaitSongSourcing] All songs sourced.');
      return;
    }
    console.info(`[awaitSongSourcing] ${pending} song(s) still pending…`);
  }

  console.warn('[awaitSongSourcing] Timed out waiting for song sourcing — proceeding with available audio.');
}

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
  const dateStr = new Date(playlistDate).toISOString().split('T')[0]; // YYYY-MM-DD

  // ── 1. Upload DJ segment audio ────────────────────────────────────────────
  const { rows: segs } = await pool.query<{
    id: string; position: number; segment_type: string; audio_url: string | null;
  }>(
    `SELECT id, position, segment_type, audio_url FROM dj_segments WHERE script_id = $1 ORDER BY position`,
    [scriptId],
  );

  for (const seg of segs) {
    if (!seg.audio_url) continue;
    if (seg.audio_url.startsWith('http')) continue; // Already on CDN

    const s3Key = `programs/${stationSlug}/${dateStr}/${seg.position}_${seg.segment_type}.mp3`;

    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
      const cdnUrl = `${publicBase}/${s3Key}`;
      await pool.query(`UPDATE dj_segments SET audio_url = $1 WHERE id = $2`, [cdnUrl, seg.id]);
      continue;
    } catch { /* not found — upload */ }

    const body = await fetchAudioBuffer(seg.audio_url);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: body, ContentType: 'audio/mpeg' }));
    const cdnUrl = `${publicBase}/${s3Key}`;
    await pool.query(`UPDATE dj_segments SET audio_url = $1 WHERE id = $2`, [cdnUrl, seg.id]);
  }

  // ── 2. Upload song audio for this program's playlist ─────────────────────
  // Songs with local filesystem paths are uploaded to R2 so the production
  // player can stream them. CDN URL is written back to songs.audio_url so
  // subsequent publishes skip the re-upload (idempotent).
  const { rows: songs } = await pool.query<{
    song_id: string; audio_url: string;
  }>(
    `SELECT DISTINCT s.id AS song_id, s.audio_url
     FROM dj_scripts ds
     JOIN playlists pl ON pl.id = ds.playlist_id
     JOIN playlist_entries pe ON pe.playlist_id = pl.id
     JOIN songs s ON s.id = pe.song_id
     WHERE ds.id = $1
       AND s.audio_url IS NOT NULL
       AND s.audio_url != ''
       AND s.audio_url NOT LIKE 'http%.aac'`,
    [scriptId],
  );

  for (const song of songs) {
    // Songs are transcoded to ADTS AAC so they share the same codec as DJ segments.
    const s3Key = `songs/${song.song_id}.aac`;

    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
      // Already uploaded — ensure DB has CDN URL and correct duration
      const cdnUrl = `${publicBase}/${s3Key}`;
      await pool.query(`UPDATE songs SET audio_url = $1 WHERE id = $2`, [cdnUrl, song.song_id]);
      continue;
    } catch { /* not found — transcode + upload */ }

    const localMusicDir = process.env.LOCAL_MUSIC_DIR;
    const srcPath = localMusicDir && song.audio_url.startsWith(localMusicDir)
      ? song.audio_url.replace(localMusicDir, '/library')
      : song.audio_url;

    if (!fs.existsSync(srcPath)) {
      console.warn(`[stageUploadAssets] Song file not found, skipping: ${srcPath}`);
      continue;
    }

    // Transcode to ADTS AAC — same format as DJ segments for seamless HLS playback
    const tmpOut = path.join(os.tmpdir(), `song-${song.song_id}.aac`);
    try {
      await execFileAsync('ffmpeg', [
        '-i', srcPath,
        '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
        '-f', 'adts',
        '-y', tmpOut,
      ], { timeout: 300_000 });
    } catch (err) {
      console.warn(`[stageUploadAssets] ffmpeg transcode failed, skipping song ${song.song_id}:`, err);
      continue;
    }

    let body: Buffer;
    let durationSec: number | null = null;
    try {
      body = fs.readFileSync(tmpOut);
      // Get precise duration from ffprobe
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'quiet', '-print_format', 'json', '-show_format', tmpOut,
        ], { timeout: 10_000 });
        durationSec = parseFloat(JSON.parse(stdout).format.duration);
      } catch { /* keep existing duration */ }
    } finally {
      fs.promises.unlink(tmpOut).catch(() => {});
    }

    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: body!, ContentType: 'audio/aac' }));
    const cdnUrl = `${publicBase}/${s3Key}`;
    await pool.query(
      `UPDATE songs SET audio_url = $1${durationSec !== null ? ', duration_sec = $3' : ''} WHERE id = $2`,
      durationSec !== null ? [cdnUrl, song.song_id, durationSec] : [cdnUrl, song.song_id],
    );
    console.info(`[stageUploadAssets] Transcoded + uploaded song ${song.song_id} → ${cdnUrl}`);
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

  // For dual-DJ scripts, combine both names (e.g., "Kuya Jun & Ate Joy")
  const secondaryId = (script as Record<string, unknown>).secondary_dj_profile_id as string | null;
  if (profile && secondaryId) {
    const { rows: secRows } = await pool.query<{ name: string }>(
      `SELECT name FROM dj_profiles WHERE id = $1`, [secondaryId]);
    if (secRows[0]) {
      profile.name = `${profile.name} & ${secRows[0].name}`;
    }
  }

  const { rows: plRows } = await pool.query<{ date: string }>(
    `SELECT date FROM playlists WHERE id = $1`, [script.playlist_id],
  );
  const playlist = plRows[0];
  if (!playlist) throw new Error('Playlist not found');

  const { rows: entries } = await pool.query<{
    hour: number; position: number; song_title: string; song_artist: string;
    duration_sec: number | null; song_audio_url: string | null;
  }>(`SELECT pe.hour, pe.position, s.title AS song_title, s.artist AS song_artist,
            s.duration_sec, s.audio_url AS song_audio_url
      FROM playlist_entries pe JOIN songs s ON s.id = pe.song_id
      WHERE pe.playlist_id = $1 ORDER BY pe.hour, pe.position`, [script.playlist_id]);

  const { rows: segments } = await pool.query<{
    segment_type: string; position: number; script_text: string;
    playlist_entry_id: string | null; audio_url: string | null; audio_duration_sec: number | null;
    start_offset_sec: number | null; anchor_playlist_entry_id: string | null;
  }>(`SELECT segment_type, position, script_text, playlist_entry_id, audio_url,
            audio_duration_sec, start_offset_sec, anchor_playlist_entry_id
      FROM dj_segments WHERE script_id = $1 ORDER BY position`, [scriptId]);

  // Build entry ID → index map
  const { rows: entryRows } = await pool.query<{ id: string }>(
    `SELECT id FROM playlist_entries WHERE playlist_id = $1 ORDER BY hour, position`,
    [script.playlist_id],
  );
  const entryIndexMap = new Map(entryRows.map((e, i) => [e.id, i]));

  // Split sequential segments from floating segments
  const sequentialSegments = segments.filter((s) => s.anchor_playlist_entry_id === null);
  const floatingSegments = segments.filter((s) => s.anchor_playlist_entry_id !== null);

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
        audio_url: e.song_audio_url ?? undefined,
      })),
    },
    script: {
      generation_source: script.generation_source,
      llm_model: script.llm_model,
      review_status: script.review_status,
      // Sequential segments (play between songs)
      segments: sequentialSegments.map((seg) => ({
        segment_type: seg.segment_type,
        position: seg.position,
        script_text: seg.script_text,
        playlist_entry_ref: seg.playlist_entry_id != null
          ? (entryIndexMap.get(seg.playlist_entry_id) ?? null)
          : null,
        audio_url: seg.audio_url,
        audio_duration_sec: seg.audio_duration_sec,
      })),
      // Floating segments (play over songs at start_offset_sec into the anchored song)
      floating_segments: floatingSegments.map((seg) => ({
        segment_type: seg.segment_type,
        script_text: seg.script_text,
        audio_url: seg.audio_url,
        audio_duration_sec: seg.audio_duration_sec,
        start_offset_sec: seg.start_offset_sec,
        playlist_entry_ref: seg.anchor_playlist_entry_id != null
          ? (entryIndexMap.get(seg.anchor_playlist_entry_id) ?? null)
          : null,
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

  const data = await res.json() as { script_id: string; station_id: string; slug: string };
  if (!data.script_id) throw new Error('Ingest response missing script_id');
  // Log for traceability: confirms which production station row was resolved (#449)
  console.info(
    `[stageIngestProduction] prod station_id=${data.station_id} (slug=${data.slug}) → script_id=${data.script_id}`,
  );
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

      // Source audio for songs that have no audio_url before uploading assets.
      // Waits for the info-broker callback to update the DB (up to SONG_SOURCING_TIMEOUT_SEC).
      const { rows: songsToSource } = await pool.query<{
        song_id: string; title: string; artist: string;
      }>(
        `SELECT DISTINCT s.id AS song_id, s.title, s.artist
         FROM playlist_entries pe
         JOIN songs s ON s.id = pe.song_id
         JOIN dj_scripts sc ON sc.playlist_id = pe.playlist_id
         WHERE sc.id = $1 AND (s.audio_url IS NULL OR s.audio_url = '')`,
        [script_id],
      );
      await awaitSongSourcing(script_id, job.data.station_id, songsToSource);

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
