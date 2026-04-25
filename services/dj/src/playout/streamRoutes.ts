import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import {
  startPlayout,
  stopPlayout,
  getNowPlaying,
  getActivePlayouts,
} from './playoutScheduler.js';
import { generateHls, cleanupHls } from './hlsGenerator.js';
import { getPool } from '../db.js';

const HLS_OUTPUT_DIR = process.env.HLS_OUTPUT_PATH || path.join(process.cwd(), 'data', 'hls');

/**
 * Stream/playout routes — serves HLS content and playout control.
 * These are public routes (no auth) for OwnRadio consumption.
 */
export async function streamRoutes(app: FastifyInstance) {
  // ── Playout control (internal) ──────────────────────────────────────────────

  /** Start playout for a station. Loads latest published manifest and begins streaming. */
  app.post('/internal/playout/:stationId/start', async (req, reply) => {
    const { stationId } = req.params as { stationId: string };

    const state = await startPlayout(stationId);
    if (!state) {
      return reply.code(404).send({ error: 'No published manifest found for station' });
    }

    // Generate HLS segments from the manifest
    try {
      const hls = await generateHls(stationId, state.manifest);
      return { status: 'started', segments: hls.totalSegments, duration_sec: state.manifest.total_duration_sec };
    } catch (err) {
      stopPlayout(stationId);
      return reply.code(500).send({ error: `HLS generation failed: ${(err as Error).message}` });
    }
  });

  /** Stop playout for a station. */
  app.post('/internal/playout/:stationId/stop', async (req, reply) => {
    const { stationId } = req.params as { stationId: string };
    stopPlayout(stationId);
    await cleanupHls(stationId);
    return reply.code(204).send();
  });

  /** Get now-playing info for a station. */
  app.get('/internal/playout/:stationId/now-playing', async (req, reply) => {
    const { stationId } = req.params as { stationId: string };
    const nowPlaying = getNowPlaying(stationId);
    if (!nowPlaying) return reply.code(404).send({ error: 'Station not playing' });
    return nowPlaying;
  });

  /** List active playouts. */
  app.get('/internal/playout/active', async () => {
    return { stations: getActivePlayouts() };
  });

  // ── Public HLS streaming ────────────────────────────────────────────────────

  /**
   * Serve HLS playlist (.m3u8) for a station.
   *
   * Priority:
   *   1. CDN-backed — dynamically built from dj_segments audio_url (R2 CDN URLs).
   *      Durable across restarts; no local disk dependency.
   *   2. Local fallback — reads from HLS_OUTPUT_DIR (dev / legacy playout).
   */
  app.get('/stream/:stationId/playlist.m3u8', async (req, reply) => {
    const { stationId } = req.params as { stationId: string };

    // ── 1. Try CDN-backed playlist from DB ──────────────────────────────────
    try {
      const pool = getPool();
      const { rows } = await pool.query<{
        audio_url: string;
        audio_duration_sec: number | null;
      }>(
        `WITH latest_script AS (
           SELECT sc.id
           FROM dj_scripts sc
           JOIN playlists pl ON pl.id = sc.playlist_id
           WHERE sc.station_id = $1
             AND sc.review_status IN ('approved', 'auto_approved')
             AND EXISTS (
               SELECT 1 FROM dj_segments s2
               WHERE s2.script_id = sc.id
                 AND s2.audio_url LIKE 'http%'
             )
           ORDER BY pl.date DESC
           LIMIT 1
         )
         SELECT sort_order, audio_url, audio_duration_sec
         FROM (
           SELECT
             ds.position::float       AS sort_order,
             ds.audio_url             AS audio_url,
             ds.audio_duration_sec    AS audio_duration_sec
           FROM dj_segments ds
           JOIN latest_script ls ON ls.id = ds.script_id
           WHERE ds.audio_url LIKE 'http%'
             AND (
               -- Non-song segments (show_intro, show_outro, time_check, weather_tease, etc.): always include
               ds.segment_type NOT IN ('song_intro', 'song_transition')
               OR ds.playlist_entry_id IS NULL
               -- Song-paired segments: only include if the associated song has CDN audio
               OR EXISTS (
                 SELECT 1 FROM playlist_entries pe
                 JOIN songs s ON s.id = pe.song_id
                 WHERE pe.id = ds.playlist_entry_id
                   AND s.audio_url IS NOT NULL
                   AND s.audio_url LIKE 'http%'
               )
             )

           UNION ALL

           SELECT
             ds.position::float + 0.5  AS sort_order,
             s.audio_url               AS audio_url,
             s.duration_sec            AS audio_duration_sec
           FROM dj_segments ds
           JOIN latest_script ls ON ls.id = ds.script_id
           JOIN playlist_entries pe ON pe.id = ds.playlist_entry_id
           JOIN songs s ON s.id = pe.song_id
           WHERE ds.segment_type IN ('song_intro', 'song_transition')
             AND s.audio_url IS NOT NULL
             AND s.audio_url LIKE 'http%'
         ) combined
         ORDER BY sort_order`,
        [stationId],
      );

      if (rows.length > 0) {
        const maxDuration = Math.ceil(
          Math.max(...rows.map((r) => parseFloat(String(r.audio_duration_sec ?? 0)))),
        );
        const lines = [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          `#EXT-X-TARGETDURATION:${maxDuration || 300}`,
          '#EXT-X-PLAYLIST-TYPE:VOD',
        ];
        for (const seg of rows) {
          const dur = parseFloat(String(seg.audio_duration_sec ?? 0));
          lines.push(`#EXTINF:${dur.toFixed(3)},`);
          lines.push(encodeURI(seg.audio_url));
        }
        lines.push('#EXT-X-ENDLIST');

        return reply
          .header('Content-Type', 'application/vnd.apple.mpegurl')
          .header('Cache-Control', 'no-cache, no-store')
          .send(lines.join('\n'));
      }
    } catch (err) {
      req.log.warn({ err }, '[stream] CDN playlist query failed, falling back to local');
    }

    // ── 2. Local fallback (dev / legacy) ────────────────────────────────────
    const playlistPath = path.join(HLS_OUTPUT_DIR, stationId, 'playlist.m3u8');
    if (!fs.existsSync(playlistPath)) {
      return reply
        .code(404)
        .send({ error: 'Stream not available' });
    }
    const content = await fs.promises.readFile(playlistPath, 'utf-8');
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'no-cache, no-store')
      .send(content);
  });

  // ── Now-playing metadata API (public, for OwnRadio polling) ─────────────────

  /**
   * status.json — now-playing metadata polled by OwnRadio.
   * Must be registered BEFORE the generic :segment handler to avoid 400.
   */
  app.get('/stream/:stationId/status.json', async (req, reply) => {
    const { stationId } = req.params as { stationId: string };

    // Prefer live now-playing from the in-memory scheduler
    const nowPlaying = getNowPlaying(stationId);
    if (nowPlaying) {
      return reply
        .header('Content-Type', 'application/json')
        .send({
          title: `${nowPlaying.segment.metadata.artist} - ${nowPlaying.segment.metadata.title}`,
          artist: nowPlaying.segment.metadata.artist,
          song: nowPlaying.segment.metadata.title,
          elapsed_sec: nowPlaying.elapsed_sec,
          remaining_sec: nowPlaying.remaining_sec,
        });
    }

    // Fallback: return the first song segment from the latest approved script in DB
    try {
      const pool = getPool();
      const { rows } = await pool.query<{ song_title: string; song_artist: string }>(
        `SELECT pe_song.title AS song_title, pe_song.artist AS song_artist
         FROM dj_segments ds
         JOIN dj_scripts sc ON sc.id = ds.script_id
         JOIN playlists pl ON pl.id = sc.playlist_id
         LEFT JOIN playlist_entries pe ON pe.id = ds.playlist_entry_id
         LEFT JOIN songs pe_song ON pe_song.id = pe.song_id
         WHERE sc.station_id = $1
           AND sc.review_status IN ('approved', 'auto_approved')
           AND ds.segment_type IN ('song_intro', 'song_transition')
           AND pe_song.title IS NOT NULL
         ORDER BY pl.date DESC, ds.position ASC
         LIMIT 1`,
        [stationId],
      );

      const track = rows[0];
      return reply
        .header('Content-Type', 'application/json')
        .send({
          title: track ? `${track.song_artist} - ${track.song_title}` : 'PlayGen Radio',
          artist: track?.song_artist ?? '',
          song: track?.song_title ?? '',
        });
    } catch {
      return reply
        .header('Content-Type', 'application/json')
        .send({ title: 'PlayGen Radio', artist: '', song: '' });
    }
  });

  /** Serve HLS segment (.ts) for a station (local/legacy playout only). */
  app.get('/stream/:stationId/:segment', async (req, reply) => {
    const { stationId, segment } = req.params as { stationId: string; segment: string };

    if (!segment.endsWith('.ts')) {
      return reply.code(404).send({ error: 'Segment not found' });
    }

    const segmentPath = path.join(HLS_OUTPUT_DIR, stationId, segment);
    if (!fs.existsSync(segmentPath)) {
      return reply.code(404).send({ error: 'Segment not found' });
    }

    const stream = fs.createReadStream(segmentPath);
    return reply
      .header('Content-Type', 'video/mp2t')
      .header('Cache-Control', 'public, max-age=3600')
      .send(stream);
  });

  /** Get current track metadata — extended format. */
  app.get('/stream/:stationId/metadata', async (req, reply) => {
    const { stationId } = req.params as { stationId: string };
    const nowPlaying = getNowPlaying(stationId);

    if (!nowPlaying) {
      return reply.code(404).send({ error: 'Station not playing' });
    }

    return reply.send({
        icestats: {
          source: {
            title: `${nowPlaying.segment.metadata.artist} - ${nowPlaying.segment.metadata.title}`,
          },
        },
        playgen: {
          segment: nowPlaying.segment,
          elapsed_sec: nowPlaying.elapsed_sec,
          remaining_sec: nowPlaying.remaining_sec,
          next: nowPlaying.next_segment?.metadata,
        },
      });
  });
}
