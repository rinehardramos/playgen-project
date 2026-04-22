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

  /** Serve HLS playlist (.m3u8) for a station. */
  app.get('/stream/:stationId/playlist.m3u8', async (req, reply) => {
    const { stationId } = req.params as { stationId: string };
    const playlistPath = path.join(HLS_OUTPUT_DIR, stationId, 'playlist.m3u8');

    if (!fs.existsSync(playlistPath)) {
      return reply.code(404).send({ error: 'Stream not available' });
    }

    const content = await fs.promises.readFile(playlistPath, 'utf-8');
    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'no-cache, no-store')
      .header('Access-Control-Allow-Origin', '*')
      .send(content);
  });

  /** Serve HLS segment (.ts) for a station. */
  app.get('/stream/:stationId/:segment', async (req, reply) => {
    const { stationId, segment } = req.params as { stationId: string; segment: string };

    if (!segment.endsWith('.ts')) {
      return reply.code(400).send({ error: 'Invalid segment' });
    }

    const segmentPath = path.join(HLS_OUTPUT_DIR, stationId, segment);
    if (!fs.existsSync(segmentPath)) {
      return reply.code(404).send({ error: 'Segment not found' });
    }

    const stream = fs.createReadStream(segmentPath);
    return reply
      .header('Content-Type', 'video/mp2t')
      .header('Cache-Control', 'public, max-age=3600')
      .header('Access-Control-Allow-Origin', '*')
      .send(stream);
  });

  // ── Now-playing metadata API (public, for OwnRadio polling) ─────────────────

  /** Get current track metadata — compatible with Icecast JSON format for OwnRadio. */
  app.get('/stream/:stationId/metadata', async (req, reply) => {
    const { stationId } = req.params as { stationId: string };
    const nowPlaying = getNowPlaying(stationId);

    if (!nowPlaying) {
      return reply.code(404).send({ error: 'Station not playing' });
    }

    // Return in Icecast-compatible format for OwnRadio compatibility
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .send({
        icestats: {
          source: {
            title: `${nowPlaying.segment.metadata.artist} - ${nowPlaying.segment.metadata.title}`,
          },
        },
        // Extended metadata for direct integration
        playgen: {
          segment: nowPlaying.segment,
          elapsed_sec: nowPlaying.elapsed_sec,
          remaining_sec: nowPlaying.remaining_sec,
          next: nowPlaying.next_segment?.metadata,
        },
      });
  });
}
