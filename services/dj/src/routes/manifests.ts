import type { FastifyInstance } from 'fastify';
import { buildProgramManifest, getManifestByScript } from '../services/manifestService.js';
import type { ProgramManifest, ShowManifest } from '../services/manifestService.js';
import { triggerPlayout } from '../playout/playoutTrigger.js';
import { generateHls } from '../playout/hlsGenerator.js';
import { getPool } from '../db.js';

/**
 * Internal manifest routes — not exposed through the gateway.
 * Called by station-service during publish.
 */
export async function manifestRoutes(app: FastifyInstance) {
  // Build program manifest for an episode
  app.post('/internal/manifests/build', async (req, reply) => {
    const { episode_id } = req.body as { episode_id: string };
    if (!episode_id) return reply.code(400).send({ error: 'episode_id required' });

    const manifest = await buildProgramManifest(episode_id);
    triggerPlayout(manifest).catch((err) =>
      app.log.error({ err }, '[manifests] triggerPlayout failed'),
    );
    return {
      manifest_url: `manifests/${episode_id}.json`,
      total_duration_sec: manifest.total_duration_sec,
    };
  });

  // Get manifest by script ID
  app.get('/internal/manifests/by-script/:scriptId', async (req, reply) => {
    const { scriptId } = req.params as { scriptId: string };
    const manifest = await getManifestByScript(scriptId);
    if (!manifest) return reply.code(404).send({ error: 'Manifest not found' });
    return manifest;
  });

  /**
   * Trigger HLS generation + OwnRadio webhook directly from a script's
   * existing ShowManifest. Used for E2E benchmarking without needing a
   * fully-linked program_episode record.
   *
   * POST /internal/playout/trigger-by-script
   * Body: { script_id: string }
   */
  app.post('/internal/playout/trigger-by-script', async (req, reply) => {
    const { script_id } = req.body as { script_id: string };
    if (!script_id) return reply.code(400).send({ error: 'script_id required' });

    // Load the existing ShowManifest row to get station_id and manifest_url
    const manifestRow = await getManifestByScript(script_id);
    if (!manifestRow) {
      return reply.code(404).send({ error: 'No manifest found for script' });
    }

    // Fetch the ShowManifest JSON from the CDN URL
    const res = await fetch(manifestRow.manifest_url);
    if (!res.ok) {
      return reply.code(502).send({ error: `Failed to fetch manifest: ${res.status}` });
    }
    const showManifest = await res.json() as ShowManifest;

    // Convert ShowManifest → ProgramManifest for the HLS generator
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
        metadata: {
          title: item.title ?? item.type,
          artist: item.artist ?? 'DJ',
        },
      };
    });

    const programManifest: ProgramManifest = {
      version: 1,
      station_id: manifestRow.station_id,
      episode_id: script_id, // use script_id as proxy
      air_date: new Date().toISOString().slice(0, 10),
      total_duration_sec: cumulativeSec,
      segments,
    };

    app.log.info({ stationId: manifestRow.station_id, segments: segments.length },
      '[trigger-by-script] starting HLS generation');

    const hls = await generateHls(manifestRow.station_id, programManifest);

    app.log.info({ segments: hls.totalSegments }, '[trigger-by-script] HLS ready');

    // Fire OwnRadio webhook
    const OWNRADIO_WEBHOOK_URL = process.env.OWNRADIO_WEBHOOK_URL ?? '';
    const PLAYGEN_WEBHOOK_SECRET = process.env.PLAYGEN_WEBHOOK_SECRET ?? '';
    const GATEWAY_URL = process.env.GATEWAY_URL ?? 'https://api.playgen.site';

    if (OWNRADIO_WEBHOOK_URL) {
      const { rows } = await getPool().query<{ slug: string }>(
        'SELECT slug FROM stations WHERE id = $1',
        [manifestRow.station_id],
      ).catch(() => ({ rows: [] as { slug: string }[] }));

      const slug = rows[0]?.slug;
      if (slug) {
        const streamUrl = `${GATEWAY_URL}/stream/${manifestRow.station_id}/playlist.m3u8`;
        const webhookUrl = `${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/stream-control`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (PLAYGEN_WEBHOOK_SECRET) headers['X-PlayGen-Secret'] = PLAYGEN_WEBHOOK_SECRET;

        await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'url_change', streamUrl }),
        }).catch((err) => app.log.error({ err }, '[trigger-by-script] webhook failed'));

        app.log.info({ slug, streamUrl }, '[trigger-by-script] OwnRadio notified');
      }
    }

    return {
      status: 'ok',
      station_id: manifestRow.station_id,
      total_segments: hls.totalSegments,
      stream_url: `${GATEWAY_URL}/stream/${manifestRow.station_id}/playlist.m3u8`,
    };
  });
}
