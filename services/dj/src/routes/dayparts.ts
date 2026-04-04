import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import * as daypartService from '../services/daypartService.js';
import type { DjDaypart } from '@playgen/types';

export async function daypartRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get<{ Params: { stationId: string } }>('/dj/stations/:stationId/dayparts', async (req) => {
    return daypartService.listDayparts(req.params.stationId);
  });

  app.put<{
    Params: { stationId: string; daypart: DjDaypart };
    Body: { dj_profile_id: string; start_hour: number; end_hour: number };
  }>('/dj/stations/:stationId/dayparts/:daypart', async (req, reply) => {
    const { stationId, daypart } = req.params;
    const { dj_profile_id, start_hour, end_hour } = req.body;
    const assignment = await daypartService.upsertDaypart(
      stationId, daypart, dj_profile_id, start_hour, end_hour,
    );
    return reply.code(200).send(assignment);
  });

  app.delete<{ Params: { stationId: string; daypart: DjDaypart } }>(
    '/dj/stations/:stationId/dayparts/:daypart',
    async (req, reply) => {
      const deleted = await daypartService.deleteDaypart(req.params.stationId, req.params.daypart);
      if (!deleted) return reply.notFound('Daypart assignment not found');
      return reply.code(204).send();
    },
  );
}
