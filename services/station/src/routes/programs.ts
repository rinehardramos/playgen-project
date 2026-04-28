import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import * as programService from '../services/programService';
import { notifyStreamUrlChange } from '../services/streamControlNotifier';
import { generateStationArtwork } from '../services/imageGenerator';
import { getPool } from '../db';

export async function programRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  // ─── Programs ──────────────────────────────────────────────────────────────

  app.get('/stations/:stationId/programs', {
    onRequest: [requirePermission('program:read'), requireStationAccess()],
  }, async (req) => {
    const { stationId } = req.params as { stationId: string };
    return programService.listPrograms(stationId);
  });

  app.post('/stations/:stationId/programs', {
    onRequest: [requirePermission('program:write'), requireStationAccess()],
  }, async (req, reply) => {
    const { stationId } = req.params as { stationId: string };
    const body = req.body as {
      name: string;
      description?: string;
      active_days?: string[];
      start_hour?: number;
      end_hour?: number;
      template_id?: string | null;
      color_tag?: string | null;
    };
    const program = await programService.createProgram({ ...body, station_id: stationId });

    // Fire-and-forget: generate DALL-E station artwork when a new program is delivered.
    // Fetch station name for a better prompt; use program description as genre hint.
    getPool()
      .query<{ id: string; name: string }>(`SELECT id, name FROM stations WHERE id = $1`, [stationId])
      .then(({ rows }) => {
        if (rows[0]) {
          generateStationArtwork({
            id: stationId,
            name: rows[0].name,
            genre: body.description ?? null,
          }).catch((err) => req.log.warn({ err }, 'Station artwork generation failed'));
        }
      })
      .catch((err) => req.log.warn({ err }, 'Failed to fetch station for artwork generation'));

    return reply.code(201).send(program);
  });

  app.get('/programs/:id', {
    onRequest: [requirePermission('program:read')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const program = await programService.getProgram(id);
    if (!program) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Program not found' } });
    return program;
  });

  app.put('/programs/:id', {
    onRequest: [requirePermission('program:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const program = await programService.updateProgram(
      id,
      req.body as Parameters<typeof programService.updateProgram>[1]
    );
    if (!program) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Program not found' } });
    return program;
  });

  app.delete('/programs/:id', {
    onRequest: [requirePermission('program:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await programService.deleteProgram(id);
    // deleteProgram only deletes non-default programs
    if (!deleted) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Program not found or is the default program' } });
    return reply.code(204).send();
  });

  // ─── Show Format Clocks ────────────────────────────────────────────────────

  app.get('/programs/:id/clocks', {
    onRequest: [requirePermission('program:read')],
  }, async (req) => {
    const { id } = req.params as { id: string };
    const clocks = await programService.listClocks(id);
    // Attach slots to each clock
    const withSlots = await Promise.all(
      clocks.map(async (clock) => ({
        ...clock,
        slots: await programService.listClockSlots(clock.id),
      }))
    );
    return withSlots;
  });

  app.post('/programs/:id/clocks', {
    onRequest: [requirePermission('program:write')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      applies_to_hours?: number[] | null;
      is_default?: boolean;
      slots?: Array<Parameters<typeof programService.upsertClockSlots>[1][number]>;
    };
    const clock = await programService.createClock({ ...body, program_id: id });
    if (body.slots?.length) {
      await programService.upsertClockSlots(clock.id, body.slots);
    }
    const slots = await programService.listClockSlots(clock.id);
    return reply.code(201).send({ ...clock, slots });
  });

  app.put('/programs/:id/clocks/:clockId', {
    onRequest: [requirePermission('program:write')],
  }, async (req, reply) => {
    const { clockId } = req.params as { id: string; clockId: string };
    const body = req.body as {
      name?: string;
      applies_to_hours?: number[] | null;
      is_default?: boolean;
      slots?: Array<Parameters<typeof programService.upsertClockSlots>[1][number]>;
    };
    const clock = await programService.updateClock(clockId, body);
    if (!clock) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Clock not found' } });
    if (body.slots !== undefined) {
      await programService.upsertClockSlots(clockId, body.slots);
    }
    const slots = await programService.listClockSlots(clockId);
    return { ...clock, slots };
  });

  app.delete('/programs/:id/clocks/:clockId', {
    onRequest: [requirePermission('program:write')],
  }, async (req, reply) => {
    const { clockId } = req.params as { id: string; clockId: string };
    const deleted = await programService.deleteClock(clockId);
    if (!deleted) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Clock not found' } });
    return reply.code(204).send();
  });

  // ─── Program Episodes ──────────────────────────────────────────────────────

  app.get('/programs/:id/episodes', {
    onRequest: [requirePermission('program:read')],
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { month } = req.query as { month?: string };
    return programService.listEpisodes(id, month);
  });

  app.get('/program-episodes/:episodeId', {
    onRequest: [requirePermission('program:read')],
  }, async (req, reply) => {
    const { episodeId } = req.params as { episodeId: string };
    const episode = await programService.getEpisode(episodeId);
    if (!episode) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found' } });
    return episode;
  });

  app.put('/program-episodes/:episodeId', {
    onRequest: [requirePermission('program:write')],
  }, async (req, reply) => {
    const { episodeId } = req.params as { episodeId: string };
    const episode = await programService.updateEpisode(
      episodeId,
      req.body as Parameters<typeof programService.updateEpisode>[1]
    );
    if (!episode) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found' } });
    return episode;
  });

  // Validate publish readiness (dry-run)
  app.get('/program-episodes/:episodeId/publish-check', {
    onRequest: [requirePermission('program:read')],
  }, async (req) => {
    const { episodeId } = req.params as { episodeId: string };
    return programService.validatePublishReadiness(episodeId);
  });

  // Publish episode (validates, builds manifest, sets status)
  app.post('/program-episodes/:episodeId/publish', {
    onRequest: [requirePermission('program:write')],
  }, async (req, reply) => {
    const { episodeId } = req.params as { episodeId: string };
    const user = (req as unknown as { user: { sub: string } }).user;
    const body = req.body as { force?: boolean } | undefined;

    const result = await programService.publishEpisode(episodeId, user.sub, { force: body?.force });

    if (!result.episode && !result.validation.ready) {
      return reply.code(422).send({
        error: { code: 'NOT_READY', message: 'Episode is not ready for publishing' },
        validation: result.validation,
      });
    }
    if (!result.episode) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Episode not found' } });
    }

    // Fire-and-forget: notify OwnRadio of the new stream URL if a manifest was built
    if (result.manifest_url) {
      const { rows } = await getPool().query<{ slug: string }>(
        `SELECT s.slug FROM stations s
         JOIN programs p ON p.station_id = s.id
         WHERE p.id = (SELECT program_id FROM program_episodes WHERE id = $1)`,
        [episodeId],
      );
      if (rows[0]?.slug) {
        notifyStreamUrlChange(rows[0].slug, result.manifest_url).catch((err) => {
          req.log.warn({ err }, 'stream-control notify failed');
        });
      }
    }

    return {
      episode: result.episode,
      validation: result.validation,
      manifest_url: result.manifest_url,
    };
  });
}
