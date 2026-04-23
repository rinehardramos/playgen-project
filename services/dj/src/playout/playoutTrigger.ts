import { getPool } from '../db.js';
import { startPlayout } from './playoutScheduler.js';
import { generateHls } from './hlsGenerator.js';
import type { ProgramManifest } from '../services/manifestService.js';

const OWNRADIO_WEBHOOK_URL = process.env.OWNRADIO_WEBHOOK_URL ?? '';
const PLAYGEN_WEBHOOK_SECRET = process.env.PLAYGEN_WEBHOOK_SECRET ?? '';
const GATEWAY_URL = process.env.GATEWAY_URL ?? 'https://api.playgen.site';

/**
 * Called after buildProgramManifest completes (fire-and-forget).
 * Starts HLS generation and notifies OwnRadio with the stream URL.
 * Never throws — all errors are logged.
 */
export async function triggerPlayout(manifest: ProgramManifest): Promise<void> {
  const stationId = manifest.station_id;

  const state = await startPlayout(stationId);
  if (!state) {
    console.warn(`[playoutTrigger] No published manifest for station=${stationId}`);
    return;
  }

  try {
    const hls = await generateHls(stationId, manifest);
    console.info(`[playoutTrigger] HLS ready station=${stationId} segments=${hls.totalSegments}`);
  } catch (err) {
    console.error(`[playoutTrigger] HLS generation failed station=${stationId}`, err);
    return;
  }

  const pool = getPool();
  const { rows } = await pool.query('SELECT slug FROM stations WHERE id = $1', [stationId]).catch(() => ({ rows: [] }));
  const slug = rows[0]?.slug;
  if (!slug || !OWNRADIO_WEBHOOK_URL) return;

  const streamUrl = `${GATEWAY_URL}/stream/${stationId}/playlist.m3u8`;
  const webhookUrl = `${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/stream-control`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (PLAYGEN_WEBHOOK_SECRET) headers['X-PlayGen-Secret'] = PLAYGEN_WEBHOOK_SECRET;

  await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'url_change', streamUrl }),
  }).catch((err) => console.error('[playoutTrigger] webhook failed', err));

  console.info(`[playoutTrigger] OwnRadio notified slug=${slug}`);
}
