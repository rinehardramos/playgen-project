import type { FastifyInstance } from 'fastify';
import { buildProgramManifest, getManifestByScript } from '../services/manifestService.js';

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
}
