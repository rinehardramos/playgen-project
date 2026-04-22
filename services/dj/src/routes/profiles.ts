import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import * as profileService from '../services/profileService.js';
import { listElevenLabsVoices } from '../adapters/tts/elevenlabs.js';
import { GOOGLE_TTS_VOICES } from '../adapters/tts/google.js';
import { config } from '../config.js';
import { getPool } from '../db.js';

const OPENAI_VOICES = [
  { id: 'alloy', name: 'Alloy', provider: 'openai' },
  { id: 'echo', name: 'Echo', provider: 'openai' },
  { id: 'fable', name: 'Fable', provider: 'openai' },
  { id: 'onyx', name: 'Onyx', provider: 'openai' },
  { id: 'nova', name: 'Nova', provider: 'openai' },
  { id: 'shimmer', name: 'Shimmer', provider: 'openai' },
];

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // All routes require auth
  app.addHook('preHandler', authenticate);

  app.get('/dj/profiles', async (req, _reply) => {
    const company_id = (req as any).user.cid;
    return profileService.listProfiles(company_id);
  });

  app.get<{ Params: { id: string } }>('/dj/profiles/:id', async (req, reply) => {
    const company_id = (req as any).user.cid;
    const profile = await profileService.getProfile(req.params.id, company_id);
    if (!profile) return reply.notFound('DJ profile not found');
    return profile;
  });

  app.post('/dj/profiles', async (req, reply) => {
    const company_id = (req as any).user.cid;
    const profile = await profileService.createProfile(company_id, req.body as any);
    return reply.code(201).send(profile);
  });

  app.patch<{ Params: { id: string } }>('/dj/profiles/:id', async (req, reply) => {
    const company_id = (req as any).user.cid;
    const profile = await profileService.updateProfile(req.params.id, company_id, req.body as any);
    if (!profile) return reply.notFound('DJ profile not found');
    return profile;
  });

  app.delete<{ Params: { id: string } }>('/dj/profiles/:id', async (req, reply) => {
    const company_id = (req as any).user.cid;
    const deleted = await profileService.deleteProfile(req.params.id, company_id);
    if (!deleted) return reply.badRequest('Cannot delete default profile or profile not found');
    return reply.code(204).send();
  });

  // List voices: OpenAI (static) + ElevenLabs (live API if key configured, else fallback)
  app.get<{ Querystring: { station_id?: string } }>('/dj/tts/voices', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, _reply) => {
    // Allow station-level API key override for ElevenLabs
    let elevenLabsKey = config.tts.elevenlabsApiKey;
    if (req.query.station_id) {
      const { rows } = await getPool().query(
        `SELECT value FROM station_settings WHERE station_id = $1 AND key = 'tts_api_key'`,
        [req.query.station_id]
      );
      if (rows[0]?.value) elevenLabsKey = rows[0].value;
    }

    const elevenlabsVoices = await listElevenLabsVoices(elevenLabsKey || undefined);

    return [...OPENAI_VOICES, ...elevenlabsVoices, ...GOOGLE_TTS_VOICES];
  });
}
