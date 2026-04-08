import type { FastifyInstance } from 'fastify';
import { segmentQueue } from '../queues/segmentQueue.js';
import { getPool } from '../db.js';
import type { DjSegmentType } from '@playgen/types';

const DJ_SEGMENT_TYPES: DjSegmentType[] = [
  'show_intro', 'show_outro', 'song_intro', 'song_transition',
  'weather_tease', 'current_events', 'listener_activity', 'station_id',
  'time_check', 'joke', 'adlib',
];

export async function segmentRoutes(app: FastifyInstance) {
  // POST /dj/segments/generate — enqueue a standalone segment generation job
  app.post('/dj/segments/generate', {
    schema: {
      body: {
        type: 'object',
        required: ['stationId', 'segmentType'],
        properties: {
          stationId: { type: 'string', format: 'uuid' },
          segmentType: { type: 'string', enum: DJ_SEGMENT_TYPES },
          withAudio: { type: 'boolean' },
          djProfileId: { type: 'string', format: 'uuid' },
          overrides: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      stationId: string;
      segmentType: DjSegmentType;
      withAudio?: boolean;
      djProfileId?: string;
      overrides?: object;
    };

    // Tenant check: verify station belongs to caller's company
    const user = (req as unknown as { user?: { company_id: string } }).user;
    if (user) {
      const { rows } = await getPool().query(
        `SELECT id FROM stations WHERE id = $1 AND company_id = $2`,
        [body.stationId, user.company_id],
      );
      if (rows.length === 0) {
        return reply.code(403).send({ error: 'Station not found or access denied' });
      }
    }

    const job = await segmentQueue.add('generate-segment', {
      stationId: body.stationId,
      segmentType: body.segmentType,
      withAudio: body.withAudio,
      djProfileId: body.djProfileId,
      overrides: body.overrides,
    });

    return reply.code(202).send({ jobId: job.id });
  });

  // GET /dj/segments/jobs/:jobId — poll job status
  app.get<{ Params: { jobId: string } }>('/dj/segments/jobs/:jobId', async (req, reply) => {
    const job = await segmentQueue.getJob(req.params.jobId);
    if (!job) {
      return reply.code(404).send({ error: 'Job not found' });
    }

    const state = await job.getState();
    if (state === 'completed') {
      const result = job.returnvalue as { segmentId: string; text: string; audioUrl?: string } | undefined;
      // Fetch full segment from DB
      const { rows } = await getPool().query(
        `SELECT id, script_text, audio_url FROM dj_segments WHERE id = $1`,
        [result?.segmentId],
      );
      return {
        status: 'completed',
        segment: rows[0]
          ? { id: rows[0].id, text: rows[0].script_text, audioUrl: rows[0].audio_url }
          : undefined,
      };
    }

    if (state === 'failed') {
      return { status: 'failed', error: job.failedReason ?? 'Unknown error' };
    }

    return { status: state };
  });
}
