/**
 * Podcast episode routes — import your own script (or generate one from a
 * topic) and render it as a two-host show, each host with their own voice AI
 * (Mistral Voxtral, ElevenLabs incl. cloned voices, etc.).
 *
 * POST   /dj/podcasts            create + start rendering (fire-and-forget)
 * GET    /dj/podcasts?station_id list a station's episodes
 * GET    /dj/podcasts/:id        episode detail (poll for status/audio_url)
 * POST   /dj/podcasts/:id/render re-render a failed/finished episode
 * DELETE /dj/podcasts/:id        remove an episode
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import { getPool } from '../db.js';
import {
  createEpisode,
  deleteEpisode,
  getEpisode,
  listEpisodes,
  renderEpisode,
  validateHosts,
  type PodcastHost,
} from '../services/podcastService.js';

interface CreatePodcastBody {
  station_id: string;
  title: string;
  hosts: PodcastHost[];
  script_text?: string;
  topic?: string;
}

async function stationBelongsToCompany(stationId: string, companyId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `SELECT 1 FROM stations WHERE id = $1 AND company_id = $2`,
    [stationId, companyId],
  );
  return (rowCount ?? 0) > 0;
}

export async function podcastRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.post<{ Body: CreatePodcastBody }>('/dj/podcasts', async (req, reply) => {
    const user = (req as any).user;
    const { station_id, title, hosts, script_text, topic } = req.body ?? ({} as CreatePodcastBody);

    if (!station_id) return reply.badRequest('station_id is required');
    if (!title?.trim()) return reply.badRequest('title is required');
    const hostError = validateHosts(hosts);
    if (hostError) return reply.badRequest(hostError);
    if (!script_text?.trim() && !topic?.trim()) {
      return reply.badRequest('provide script_text (import your own script) or topic (generate one)');
    }
    if (!(await stationBelongsToCompany(station_id, user.cid))) {
      return reply.forbidden('Station not found or access denied');
    }

    const episode = await createEpisode({
      station_id,
      title: title.trim(),
      hosts,
      script_text,
      topic,
      created_by: user.sub,
    });

    // Fire-and-forget render; hosts carry any bring-your-own api_key in memory only.
    renderEpisode(episode.id, hosts).catch((err) =>
      req.log.error({ err, episode_id: episode.id }, 'podcast render crashed'),
    );

    return reply.code(202).send(episode);
  });

  app.get<{ Querystring: { station_id?: string } }>('/dj/podcasts', async (req, reply) => {
    const user = (req as any).user;
    const { station_id } = req.query;
    if (!station_id) return reply.badRequest('station_id query param is required');
    if (!(await stationBelongsToCompany(station_id, user.cid))) {
      return reply.forbidden('Station not found or access denied');
    }
    return listEpisodes(station_id);
  });

  app.get<{ Params: { id: string } }>('/dj/podcasts/:id', async (req, reply) => {
    const user = (req as any).user;
    const episode = await getEpisode(req.params.id);
    if (!episode) return reply.notFound('Episode not found');
    if (!(await stationBelongsToCompany(episode.station_id, user.cid))) {
      return reply.forbidden('Station not found or access denied');
    }
    return episode;
  });

  app.post<{ Params: { id: string }; Body: { hosts?: PodcastHost[] } }>(
    '/dj/podcasts/:id/render',
    async (req, reply) => {
      const user = (req as any).user;
      const episode = await getEpisode(req.params.id);
      if (!episode) return reply.notFound('Episode not found');
      if (!(await stationBelongsToCompany(episode.station_id, user.cid))) {
        return reply.forbidden('Station not found or access denied');
      }
      // Optional host override lets callers re-supply bring-your-own api keys
      // (they are never persisted) or swap voices before re-rendering.
      let hosts = episode.hosts as PodcastHost[];
      if (req.body?.hosts) {
        const hostError = validateHosts(req.body.hosts);
        if (hostError) return reply.badRequest(hostError);
        hosts = req.body.hosts;
      }
      renderEpisode(episode.id, hosts).catch((err) =>
        req.log.error({ err, episode_id: episode.id }, 'podcast re-render crashed'),
      );
      return reply.code(202).send({ id: episode.id, status: 'rendering' });
    },
  );

  app.delete<{ Params: { id: string } }>('/dj/podcasts/:id', async (req, reply) => {
    const user = (req as any).user;
    const episode = await getEpisode(req.params.id);
    if (!episode) return reply.notFound('Episode not found');
    if (!(await stationBelongsToCompany(episode.station_id, user.cid))) {
      return reply.forbidden('Station not found or access denied');
    }
    await deleteEpisode(req.params.id);
    return reply.code(204).send();
  });
}
