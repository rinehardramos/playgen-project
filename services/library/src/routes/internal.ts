import type { FastifyInstance } from 'fastify';
import { getPool } from '../db';

interface AudioSourcedBody {
  station_id: string;
  status: 'completed' | 'partial' | 'failed';
  sourced: number;
  songs?: Array<{ song_id: string; r2_key: string }>;
  errors?: Array<{ song_id: string; error: string }>;
}

/**
 * POST /internal/songs/audio-sourced
 *
 * Callback from info-broker after it has sourced and uploaded audio to R2.
 * No auth middleware — internal endpoint reachable only within the private network.
 */
export async function internalRoutes(app: FastifyInstance) {
  app.post<{ Body: AudioSourcedBody }>(
    '/internal/songs/audio-sourced',
    async (req, reply) => {
      const body = req.body;

      // Basic validation
      if (!body || typeof body.station_id !== 'string' || typeof body.status !== 'string') {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'station_id and status are required' },
        });
      }

      if (!['completed', 'partial', 'failed'].includes(body.status)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'status must be completed, partial, or failed',
          },
        });
      }

      // Acknowledge failures without any DB work
      if (body.status === 'failed' || !body.songs || body.songs.length === 0) {
        app.log.warn(
          { station_id: body.station_id, status: body.status, errors: body.errors },
          '[audio-sourced] sourcing did not produce songs — acknowledged',
        );
        return reply.code(200).send({ ok: true });
      }

      const s3PublicUrlBase = (process.env.S3_PUBLIC_URL_BASE ?? '').replace(/\/$/, '');
      const pool = getPool();

      try {
        for (const { song_id, r2_key } of body.songs) {
          // Build the public URL from the R2 key.
          // If S3_PUBLIC_URL_BASE is set, use it; otherwise store the key as-is.
          const audioUrl = s3PublicUrlBase ? `${s3PublicUrlBase}/${r2_key}` : r2_key;

          await pool.query(
            `UPDATE songs SET audio_url = $1, audio_source = 'youtube', updated_at = NOW() WHERE id = $2`,
            [audioUrl, song_id],
          );
        }
      } catch (err) {
        app.log.error(err, '[audio-sourced] DB update failed');
        return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'DB update failed' } });
      }

      app.log.info(
        { station_id: body.station_id, sourced: body.sourced },
        '[audio-sourced] audio_url updated for sourced songs',
      );
      return reply.code(200).send({ ok: true });
    },
  );
}
