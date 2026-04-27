import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import {
  runScan,
  isScanning,
  getScanProgress,
  getLastScanResult,
} from '../services/musicScannerService';
import { getPool } from '../db';

export async function scanRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  // ── POST /stations/:id/scan-music — trigger a scan ─────────────────────────
  app.post<{
    Params: { id: string };
    Body: {
      dir?: string;
      recursive?: boolean;
      transcode?: boolean;
      extensions?: string;
    };
  }>('/stations/:id/scan-music', {
    onRequest: [requirePermission('library:write'), requireStationAccess()],
  }, async (req, reply) => {
    const stationId = req.params.id;
    const companyId = req.user.cid;

    if (isScanning(stationId)) {
      return reply.code(409).send({
        error: { code: 'SCAN_IN_PROGRESS', message: 'A scan is already running for this station' },
      });
    }

    // Resolve settings: body overrides > station_settings > defaults
    const pool = getPool();
    const { rows: settingRows } = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM station_settings WHERE station_id = $1 AND key LIKE 'music_scan_%'`,
      [stationId],
    );
    const settings = Object.fromEntries(settingRows.map(r => [r.key, r.value]));

    const dir = req.body?.dir ?? settings['music_scan_dir'] ?? '';
    const recursive = req.body?.recursive ?? (settings['music_scan_recursive'] !== 'false');
    const transcode = req.body?.transcode ?? (settings['music_scan_auto_transcode'] === 'true');
    const extensions = req.body?.extensions
      ? req.body.extensions.split(',').map(e => e.trim())
      : (settings['music_scan_extensions'] ?? 'mp3,flac,wav,m4a,ogg,aac').split(',').map(e => e.trim());

    if (!dir) {
      return reply.code(400).send({
        error: { code: 'MISSING_DIRECTORY', message: 'Scan directory is required — set it in Settings or pass dir in request body' },
      });
    }

    // Fire-and-forget — respond 202 immediately
    runScan({ stationId, companyId, dir, recursive, extensions, transcode }).catch(err => {
      app.log.error({ err, stationId }, 'Music scan failed');
    });

    return reply.code(202).send({ scanning: true, message: 'Scan started', directory: dir });
  });

  // ── GET /stations/:id/scan-music/status — check scan status ────────────────
  app.get<{ Params: { id: string } }>('/stations/:id/scan-music/status', {
    onRequest: [requirePermission('library:read'), requireStationAccess()],
  }, async (req) => {
    const stationId = req.params.id;
    const scanning = isScanning(stationId);
    const progress = getScanProgress(stationId);
    const lastResult = await getLastScanResult(stationId);

    return {
      scanning,
      ...(progress ? { progress } : {}),
      ...(lastResult ? { last_result: lastResult } : {}),
    };
  });
}
