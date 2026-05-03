/**
 * Publish to Production pipeline — BullMQ queue + 5-stage worker.
 *
 * Stages (in order):
 *   1. validate        — script approved + all segments have local audio
 *   2. upload_assets   — upload MP3s to production R2; update segment audio_url with CDN URLs
 *   2b. build_hls      — generate music.m3u8 + dj.m3u8 (only if floating segments exist)
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
import {
  buildEntryCumulativeMap,
  buildMusicM3u8,
  resolveDjClips,
  buildVariantMasterM3u8,
  type DjSegmentRow,
  type VariantStream,
} from './hlsBuilder.js';

const execFileAsync = promisify(execFile);

// ── Queue ──────────────────────────────────────────────────────────────────

export const PUBLISH_QUEUE = 'program-publish';

export interface PublishJobData {
  script_id: string;
  station_id: string;
  /** publish_jobs row ID — used to update stage state */
  publish_job_id: string;
}

export type PublishStage = 'validate' | 'upload_assets' | 'build_hls' | 'ingest_production' | 'trigger_playout';

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

/** Bitrate variants to generate in addition to the high-quality base file. */
const SONG_VARIANTS: Array<{ suffix: string; bitrateK: number; channels: number }> = [
  { suffix: 'low', bitrateK: 32,  channels: 1 }, // 32kbps mono — 2G/3G fallback
  { suffix: 'mid', bitrateK: 128, channels: 2 }, // 128kbps stereo — standard
  // 'high' = existing songs/${id}.aac at 192kbps stereo — no suffix needed
];

async function uploadSongVariants(
  songId: string,
  srcPath: string,
  s3: S3Client,
  bucket: string,
  publicBase: string,
): Promise<void> {
  for (const v of SONG_VARIANTS) {
    const s3Key = `songs/${songId}.${v.suffix}.aac`;

    // Skip if already uploaded
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
      continue;
    } catch { /* not found — transcode + upload */ }

    const tmpOut = path.join(os.tmpdir(), `song-${songId}-${v.suffix}.aac`);
    try {
      await execFileAsync('ffmpeg', [
        '-i', srcPath,
        '-c:a', 'aac',
        '-b:a', `${v.bitrateK}k`,
        '-ar', '44100',
        '-ac', String(v.channels),
        '-f', 'adts',
        '-y', tmpOut,
      ], { timeout: 300_000 });

      const body = fs.readFileSync(tmpOut);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: body,
        ContentType: 'audio/aac',
      }));
      console.info(`[stageUploadAssets] Uploaded song ${songId} variant ${v.suffix} → ${publicBase}/${s3Key}`);
    } catch (err) {
      console.warn(`[stageUploadAssets] Variant ${v.suffix} failed for song ${songId} (non-fatal):`, err);
    } finally {
      fs.promises.unlink(tmpOut).catch(() => {});
    }
  }
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
       AND s.audio_url NOT LIKE 'http%.aac'
       AND s.audio_url NOT LIKE 'http%.m3u8'`,
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

    // Resolve source: remap local music dir, or download from CDN if it's an HTTP URL
    const localMusicDir = process.env.LOCAL_MUSIC_DIR;
    let srcPath: string;
    let tmpSrc: string | null = null;

    if (song.audio_url.startsWith('http')) {
      // Download from CDN to a temp file for transcoding
      const srcExt = song.audio_url.split('.').pop()?.split('?')[0] ?? 'mp3';
      tmpSrc = path.join(os.tmpdir(), `song-src-${song.song_id}.${srcExt}`);
      try {
        const res = await fetch(song.audio_url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fs.promises.writeFile(tmpSrc, Buffer.from(await res.arrayBuffer()));
        srcPath = tmpSrc;
      } catch (err) {
        console.warn(`[stageUploadAssets] Failed to download song ${song.song_id}: ${song.audio_url}`, err);
        fs.promises.unlink(tmpSrc).catch(() => {});
        continue;
      }
    } else {
      srcPath = localMusicDir && song.audio_url.startsWith(localMusicDir)
        ? song.audio_url.replace(localMusicDir, '/library')
        : song.audio_url;
      if (!fs.existsSync(srcPath)) {
        console.warn(`[stageUploadAssets] Song file not found, skipping: ${srcPath}`);
        continue;
      }
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
    } finally {
      if (tmpSrc) fs.promises.unlink(tmpSrc).catch(() => {});
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
        durationSec = Math.round(parseFloat(JSON.parse(stdout).format.duration));
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

    // Upload 32kbps + 128kbps variants for adaptive streaming (#500)
    if (srcPath && fs.existsSync(srcPath)) {
      await uploadSongVariants(song.song_id, srcPath, s3, bucket, publicBase);
    }
  }

  // ── 3. Upload station artwork if stored as local DJ API path ─────────────
  // The DJ imageGenerator stores artwork_url as /api/v1/dj/audio/... when using
  // local storage. Upload to R2 so the production ingest can store a CDN URL.
  const { rows: artRows } = await pool.query<{ id: string; artwork_url: string | null }>(
    `SELECT st.id, st.artwork_url
     FROM dj_scripts ds JOIN stations st ON st.id = ds.station_id
     WHERE ds.id = $1`, [scriptId],
  );
  const artStation = artRows[0];
  if (artStation?.artwork_url && !artStation.artwork_url.startsWith('http')) {
    try {
      const artBuffer = await fetchAudioBuffer(artStation.artwork_url);
      const artKey = `images/stations/${stationSlug}/artwork.jpg`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: artKey, Body: artBuffer, ContentType: 'image/jpeg' }));
      const artCdnUrl = `${publicBase}/${artKey}`;
      await pool.query(`UPDATE stations SET artwork_url = $1 WHERE id = $2`, [artCdnUrl, artStation.id]);
      console.info(`[stageUploadAssets] Uploaded station artwork → ${artCdnUrl}`);
    } catch (err) {
      console.warn('[stageUploadAssets] Station artwork upload failed (non-fatal):', err);
    }
  }
}

// ── Stage: build_hls ────────────────────────���────────────────────────────
//
// Generates two synchronised HLS streams for dynamic layered audio (#532):
//
//   music.m3u8  — HLS "packed audio" playlist referencing existing song CDN URLs.
//                 No re-encoding; the per-song .aac files uploaded in upload_assets
//                 are referenced directly as HLS packed-audio segments.
//
//   dj.m3u8     — Full-show silence track generated by ffmpeg (anullsrc) with every
//                 DJ audio clip (sequential + floating) mixed in at its exact
//                 program-timeline offset via ffmpeg adelay + amix.
//
// Both are uploaded to R2 and stored in dj_scripts.hls_tracks as:
//   { "music": "https://cdn.../music.m3u8", "dj": "https://cdn.../dj.m3u8" }
//
// Only runs if the script has at least one floating segment with TTS audio.
// Sequential-only scripts skip this stage (hls_tracks remains NULL).
//
async function runDjFfmpegVariant(
  ffmpegBaseArgs: string[],
  bitrateK: number,
  channels: number,
  tmpDir: string,
  suffix: string,
): Promise<{ segFiles: string[]; rawM3u8: string; segDir: string }> {
  const segDir = path.join(tmpDir, `dj_segs_${suffix}`);
  await fs.promises.mkdir(segDir, { recursive: true });
  const m3u8Path = path.join(tmpDir, `dj_${suffix}.m3u8`);

  const fullArgs = [
    ...ffmpegBaseArgs,
    '-c:a', 'aac',
    '-b:a', `${bitrateK}k`,
    '-ar', '44100',
    '-ac', String(channels),
    '-f', 'hls',
    '-hls_time', '10',
    '-hls_playlist_type', 'vod',
    '-hls_list_size', '0',
    '-hls_segment_filename', path.join(segDir, 'seg_%05d.ts'),
    m3u8Path,
  ];

  await execFileAsync('ffmpeg', fullArgs, { timeout: 600_000 });

  const rawM3u8 = await fs.promises.readFile(m3u8Path, 'utf8');
  const segFiles = rawM3u8
    .split('\n')
    .filter(l => l.endsWith('.ts'))
    .map(l => path.basename(l));

  return { segFiles, rawM3u8, segDir };
}

async function stageBuildHls(scriptId: string, stationSlug: string, dateStr: string): Promise<void> {
  const pool = getPool();
  const s3 = getS3Client();
  const bucket = process.env.S3_BUCKET ?? '';
  const publicBase = (process.env.S3_PUBLIC_URL_BASE ?? '').replace(/\/$/, '');

  // ── Check whether there are any floating segments with TTS audio ──────────
  const { rows: floatingCheck } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM dj_segments
     WHERE script_id = $1 AND anchor_playlist_entry_id IS NOT NULL AND audio_url IS NOT NULL`,
    [scriptId],
  );
  if (parseInt(floatingCheck[0]?.count ?? '0', 10) === 0) {
    console.info(`[buildHls] No floating segments with audio — skipping HLS track generation for script ${scriptId}`);
    return;
  }

  // ── Load playlist entries (songs) in show order ───────────────────────────
  const { rows: entries } = await pool.query<{
    entry_id: string; song_id: string; audio_url: string | null; duration_sec: number | null;
  }>(
    `SELECT pe.id AS entry_id, s.id AS song_id, s.audio_url, s.duration_sec
     FROM dj_scripts ds
     JOIN playlists pl ON pl.id = ds.playlist_id
     JOIN playlist_entries pe ON pe.playlist_id = pl.id
     JOIN songs s ON s.id = pe.song_id
     WHERE ds.id = $1
     ORDER BY pe.hour, pe.position`,
    [scriptId],
  );

  // ── Load all DJ segments (sequential + floating) with TTS audio ───────────
  const { rows: allSegs } = await pool.query<{
    id: string; segment_type: string; audio_url: string | null; audio_duration_sec: number | null;
    playlist_entry_id: string | null; anchor_playlist_entry_id: string | null;
    start_offset_sec: number | null;
  }>(
    `SELECT id, segment_type, audio_url, audio_duration_sec,
            playlist_entry_id, anchor_playlist_entry_id, start_offset_sec
     FROM dj_segments
     WHERE script_id = $1 AND audio_url IS NOT NULL
     ORDER BY position`,
    [scriptId],
  );

  // ── Build music-track timeline ────────────────────────────────────────────
  // Sequential DJ segments play AT their entry's start_sec in the two-track
  // model: the DJ voice overlaps the song intro while music continues.
  const entryCumulativeSec = buildEntryCumulativeMap(entries);
  const totalMusicDurationSec = entries.reduce((s, e) => s + Math.max(0, e.duration_sec ?? 0), 0);

  if (totalMusicDurationSec < 1) {
    console.warn(`[buildHls] Total music duration too short (${totalMusicDurationSec}s) — skipping`);
    return;
  }

  // ── 1. Build music.m3u8 — packed-audio HLS playlist (no ffmpeg needed) ────
  // HLS RFC 8216 §3.4 "Packed Audio" allows ADTS AAC files as HLS segments.
  // HLS.js supports this natively. We reference the existing CDN .aac URLs directly.
  const musicM3u8Content = buildMusicM3u8(entries);
  const musicM3u8Key = `programs/${stationSlug}/${dateStr}/music.m3u8`;
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: musicM3u8Key,
    Body: Buffer.from(musicM3u8Content),
    ContentType: 'application/vnd.apple.mpegurl',
  }));
  const musicM3u8Url = `${publicBase}/${musicM3u8Key}`;
  console.info(`[buildHls] Uploaded music.m3u8 → ${musicM3u8Url}`);

  // ── 2. Build dj.m3u8 — silence + DJ clips via ffmpeg amix ─────────────────
  const djClips = resolveDjClips(allSegs as DjSegmentRow[], entryCumulativeSec, totalMusicDurationSec);

  if (djClips.length === 0) {
    console.info(`[buildHls] No DJ clips resolved — uploading silence-only dj.m3u8`);
  }

  // Download DJ clips to temp dir and build ffmpeg command
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hls-dj-'));
  try {
    const localClipPaths: string[] = [];
    for (let i = 0; i < djClips.length; i++) {
      const clip = djClips[i];
      const ext = clip.audioUrl.split('.').pop()?.split('?')[0] ?? 'mp3';
      const localPath = path.join(tmpDir, `dj_clip_${i}.${ext}`);
      try {
        const res = await fetch(clip.audioUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fs.promises.writeFile(localPath, Buffer.from(await res.arrayBuffer()));
        localClipPaths.push(localPath);
      } catch (err) {
        console.warn(`[buildHls] Failed to download DJ clip ${clip.segId}: ${(err as Error).message}`);
        localClipPaths.push(''); // placeholder — will be skipped in filter build
      }
    }

    // Build base ffmpeg args: inputs only (no codec/output spec yet)
    const ffmpegBaseArgs: string[] = [
      '-y',
      '-f', 'lavfi',
      '-t', String(totalMusicDurationSec),
      '-i', 'anullsrc=r=44100:cl=stereo',
    ];

    const validClips: Array<{ clipIdx: number; localPath: string; inputIdx: number }> = [];
    for (let i = 0; i < djClips.length; i++) {
      const localPath = localClipPaths[i];
      if (!localPath) continue;
      const inputIdx = 1 + validClips.length;
      ffmpegBaseArgs.push('-itsoffset', djClips[i].offsetSec.toFixed(3));
      ffmpegBaseArgs.push('-i', localPath);
      validClips.push({ clipIdx: i, localPath, inputIdx });
    }

    // Build filter_complex: chain amix for silence base + each clip
    // [0][1][2]...amix=inputs=N:normalize=0:duration=first[out]
    const totalInputs = 1 + validClips.length;
    const inputLabels = Array.from({ length: totalInputs }, (_, i) => `[${i}]`).join('');
    const filterComplex = `${inputLabels}amix=inputs=${totalInputs}:normalize=0:duration=first[out]`;
    ffmpegBaseArgs.push('-filter_complex', filterComplex);
    ffmpegBaseArgs.push('-map', '[out]');

    /** DJ HLS quality variants */
    const DJ_HLS_VARIANTS = [
      { suffix: 'low',  bitrateK: 32,  channels: 1 },
      { suffix: 'mid',  bitrateK: 128, channels: 2 },
      { suffix: 'high', bitrateK: 256, channels: 2 },
    ] as const;

    const djM3u8Urls: Record<string, string> = {};

    for (const variant of DJ_HLS_VARIANTS) {
      const { segFiles, rawM3u8 } = await runDjFfmpegVariant(
        ffmpegBaseArgs, variant.bitrateK, variant.channels, tmpDir, variant.suffix,
      );

      const segCdnBase = `programs/${stationSlug}/${dateStr}/dj_${variant.suffix}`;
      for (const segFile of segFiles) {
        const segLocalPath = path.join(tmpDir, `dj_segs_${variant.suffix}`, segFile);
        if (!fs.existsSync(segLocalPath)) continue;
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `${segCdnBase}/${segFile}`,
          Body: fs.readFileSync(segLocalPath),
          ContentType: 'video/mp2t',
        }));
      }

      const cdnM3u8 = rawM3u8
        .split('\n')
        .map(l => l.endsWith('.ts') ? `${publicBase}/${segCdnBase}/${path.basename(l)}` : l)
        .join('\n');

      const m3u8Key = `programs/${stationSlug}/${dateStr}/dj_${variant.suffix}.m3u8`;
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: m3u8Key,
        Body: Buffer.from(cdnM3u8),
        ContentType: 'application/vnd.apple.mpegurl',
      }));
      djM3u8Urls[variant.suffix] = `${publicBase}/${m3u8Key}`;
      console.info(`[buildHls] Uploaded dj_${variant.suffix}.m3u8 (${segFiles.length} segs) → ${djM3u8Urls[variant.suffix]}`);
    }

    // Backward-compat: keep dj.m3u8 pointing to mid quality
    const legacyDjKey = `programs/${stationSlug}/${dateStr}/dj.m3u8`;
    const midRawM3u8 = await fs.promises.readFile(path.join(tmpDir, 'dj_mid.m3u8'), 'utf8');
    const midCdnM3u8 = midRawM3u8
      .split('\n')
      .map(l => l.endsWith('.ts') ? `${publicBase}/programs/${stationSlug}/${dateStr}/dj_mid/${path.basename(l)}` : l)
      .join('\n');
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: legacyDjKey,
      Body: Buffer.from(midCdnM3u8),
      ContentType: 'application/vnd.apple.mpegurl',
    }));
    const djM3u8LegacyUrl = `${publicBase}/${legacyDjKey}`;
    console.info(`[buildHls] Uploaded legacy dj.m3u8 (mid-quality copy) → ${djM3u8LegacyUrl}`);

    // ── Music variant M3U8s (low/mid) + master manifest ──────────────────────
    function deriveSongVariantUrl(baseUrl: string, suffix: string): string {
      if (baseUrl.endsWith('.aac') && baseUrl.includes('/songs/')) {
        return baseUrl.replace(/\.aac$/, `.${suffix}.aac`);
      }
      return baseUrl; // graceful degradation: use base quality
    }

    const musicMidEntries = entries.map(e => ({
      ...e,
      audio_url: e.audio_url ? deriveSongVariantUrl(e.audio_url, 'mid') : null,
    }));
    const musicLowEntries = entries.map(e => ({
      ...e,
      audio_url: e.audio_url ? deriveSongVariantUrl(e.audio_url, 'low') : null,
    }));

    const musicMidM3u8Key = `programs/${stationSlug}/${dateStr}/music_mid.m3u8`;
    const musicLowM3u8Key = `programs/${stationSlug}/${dateStr}/music_low.m3u8`;
    await Promise.all([
      s3.send(new PutObjectCommand({
        Bucket: bucket, Key: musicMidM3u8Key,
        Body: Buffer.from(buildMusicM3u8(musicMidEntries)),
        ContentType: 'application/vnd.apple.mpegurl',
      })),
      s3.send(new PutObjectCommand({
        Bucket: bucket, Key: musicLowM3u8Key,
        Body: Buffer.from(buildMusicM3u8(musicLowEntries)),
        ContentType: 'application/vnd.apple.mpegurl',
      })),
    ]);

    const musicVariants: VariantStream[] = [
      { bandwidth: 32000,  codecs: 'mp4a.40.2', uri: `${publicBase}/${musicLowM3u8Key}`, label: 'Low' },
      { bandwidth: 128000, codecs: 'mp4a.40.2', uri: `${publicBase}/${musicMidM3u8Key}`, label: 'Standard' },
      { bandwidth: 192000, codecs: 'mp4a.40.2', uri: musicM3u8Url,                       label: 'High' },
    ];
    const musicStreamKey = `programs/${stationSlug}/${dateStr}/music_stream.m3u8`;
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: musicStreamKey,
      Body: Buffer.from(buildVariantMasterM3u8(musicVariants)),
      ContentType: 'application/vnd.apple.mpegurl',
    }));
    const musicStreamUrl = `${publicBase}/${musicStreamKey}`;
    console.info(`[buildHls] Uploaded music_stream.m3u8 (master) → ${musicStreamUrl}`);

    // ── DJ master variant manifest ────────────────────────────────────────────
    const djVariants: VariantStream[] = [
      { bandwidth: 32000,  codecs: 'mp4a.40.2', uri: djM3u8Urls['low'],  label: 'Low' },
      { bandwidth: 128000, codecs: 'mp4a.40.2', uri: djM3u8Urls['mid'],  label: 'Standard' },
      { bandwidth: 256000, codecs: 'mp4a.40.2', uri: djM3u8Urls['high'], label: 'High' },
    ];
    const djStreamKey = `programs/${stationSlug}/${dateStr}/dj_stream.m3u8`;
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: djStreamKey,
      Body: Buffer.from(buildVariantMasterM3u8(djVariants)),
      ContentType: 'application/vnd.apple.mpegurl',
    }));
    const djStreamUrl = `${publicBase}/${djStreamKey}`;
    console.info(`[buildHls] Uploaded dj_stream.m3u8 (master) → ${djStreamUrl}`);

    // ── Store all URLs in dj_scripts.hls_tracks (JSONB, backward-compatible) ──
    await pool.query(
      `UPDATE dj_scripts SET hls_tracks = $1::jsonb WHERE id = $2`,
      [JSON.stringify({
        music:        musicM3u8Url,    // backward compat
        dj:           djM3u8LegacyUrl, // backward compat
        dj_stream:    djStreamUrl,     // NEW: ABR master manifest for DJ track
        music_stream: musicStreamUrl,  // NEW: ABR master manifest for music track
      }), scriptId],
    );
    console.info(`[buildHls] hls_tracks (with ABR URLs) saved for script ${scriptId}`);

  } finally {
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function stageIngestProduction(scriptId: string, token: string): Promise<string> {
  const pool = getPool();
  const gw = process.env.PROD_GATEWAY_URL ?? 'https://api.playgen.site';

  // Build the full ingest payload from local DB
  const { rows: scriptRows } = await pool.query<{
    id: string; station_id: string; playlist_id: string; dj_profile_id: string;
    review_status: string; llm_model: string; generation_source: string;
    hls_tracks: { music: string; dj: string } | null;
  }>(`SELECT *, hls_tracks FROM dj_scripts WHERE id = $1`, [scriptId]);
  const script = scriptRows[0];
  if (!script) throw new Error('Script not found');

  const { rows: stRows } = await pool.query<{
    name: string; slug: string; timezone: string; locale_code: string | null;
    city: string | null; country_code: string | null; callsign: string | null;
    tagline: string | null; frequency: string | null; artwork_url: string | null;
  }>(`SELECT name, slug, timezone, locale_code, city, country_code, callsign, tagline, frequency, artwork_url
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
      artwork_url: station.artwork_url ?? undefined,
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
    // HLS dual-track URLs (present only for layered-audio scripts with floating segments)
    hls_tracks: script.hls_tracks ?? undefined,
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

      // Stage 2b: build_hls (only runs when floating segments exist)
      const dateStr = new Date(playlist_date).toISOString().split('T')[0];
      if (!done.build_hls) {
        await setStage(publish_job_id, 'build_hls');
        await stageBuildHls(script_id, slug, dateStr);
        await completeStage(publish_job_id, 'build_hls');
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
