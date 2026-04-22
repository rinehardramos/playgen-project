/**
 * Bridge to the DJ service's manifest builder.
 *
 * In production, this would call the DJ service via internal HTTP.
 * For local development (monorepo), we import directly since both
 * services share the same database.
 */

import { getPool } from '../db';

export interface ManifestResult {
  manifest_url: string | null;
  total_duration_sec: number;
}

/**
 * Build a program manifest for an episode by calling the DJ service.
 * Falls back to a direct DB query if the HTTP call fails.
 */
export async function buildProgramManifest(episodeId: string): Promise<ManifestResult | null> {
  const djServiceUrl = process.env.DJ_SERVICE_INTERNAL_URL || 'http://localhost:3008';

  try {
    const response = await fetch(`${djServiceUrl}/internal/manifests/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episode_id: episodeId }),
      signal: AbortSignal.timeout(30_000),
    });

    if (response.ok) {
      return await response.json() as ManifestResult;
    }

    // If DJ service is not available, check if manifest already exists
    return await getExistingManifest(episodeId);
  } catch {
    // DJ service unreachable — check for existing manifest
    return await getExistingManifest(episodeId);
  }
}

async function getExistingManifest(episodeId: string): Promise<ManifestResult | null> {
  const { rows: [row] } = await getPool().query(
    `SELECT m.manifest_url, m.total_duration_sec
     FROM program_episodes pe
     JOIN dj_show_manifests m ON m.id = pe.manifest_id
     WHERE pe.id = $1`,
    [episodeId],
  );
  return row ? { manifest_url: row.manifest_url, total_duration_sec: parseFloat(row.total_duration_sec) } : null;
}
