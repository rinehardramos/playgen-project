/**
 * Public stations endpoint — no auth required.
 * Returns station + DJ data for the OwnRadio frontend and any public consumer.
 */
import type { FastifyInstance } from 'fastify';
import { getPool } from '../db';

export async function publicStationRoutes(app: FastifyInstance) {
  // GET /public/stations — list all active stations with their assigned DJ
  app.get('/public/stations', async () => {
    const pool = getPool();
    // Join via dj_daypart_assignments to get the station-specific DJ (morning daypart as representative)
    const { rows } = await pool.query(`
      SELECT
        s.id, s.name, s.slug, s.timezone, s.locale_code, s.city, s.country_code,
        s.callsign, s.tagline, s.frequency, s.is_active, s.dj_enabled,
        s.logo_url, s.primary_color, s.secondary_color,
        dp.id AS dj_id, dp.name AS dj_name, dp.personality AS dj_bio,
        dp.voice_style AS dj_voice_style,
        dp.persona_config AS dj_persona_config,
        dp.tts_provider AS dj_tts_provider,
        dp.tts_voice_id AS dj_tts_voice_id
      FROM stations s
      LEFT JOIN LATERAL (
        SELECT da.dj_profile_id
        FROM dj_daypart_assignments da
        WHERE da.station_id = s.id
        ORDER BY da.start_hour ASC
        LIMIT 1
      ) assign ON true
      LEFT JOIN dj_profiles dp ON dp.id = assign.dj_profile_id AND dp.is_active = true
      WHERE s.is_active = true AND s.slug IS NOT NULL
      ORDER BY s.name ASC
    `);

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.tagline ?? '',
      streamUrl: '',
      metadataUrl: '',
      genre: '',
      artworkUrl: r.logo_url ?? null,
      isLive: r.dj_enabled ?? false,
      status: r.dj_enabled ? 'on_air' : 'off_air',
      dj: r.dj_id ? {
        id: r.dj_id,
        name: r.dj_name,
        bio: r.dj_bio ?? '',
        avatarUrl: null,
        personality: r.dj_persona_config?.backstory ?? null,
      } : null,
      currentSong: null,
      listenerCount: 0,
    }));
  });

  // GET /public/stations/:slug — single station by slug with all DJs
  app.get<{ Params: { slug: string } }>('/public/stations/:slug', async (req, reply) => {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT
        s.id, s.name, s.slug, s.timezone, s.locale_code, s.city, s.country_code,
        s.callsign, s.tagline, s.frequency, s.is_active, s.dj_enabled,
        s.logo_url, s.primary_color, s.secondary_color
      FROM stations s
      WHERE s.slug = $1 AND s.is_active = true
    `, [req.params.slug]);

    if (!rows[0]) return reply.status(404).send({ error: 'Station not found' });
    const st = rows[0];

    // Get DJs assigned to THIS station via daypart assignments
    const { rows: djRows } = await pool.query(`
      SELECT DISTINCT dp.id, dp.name, dp.personality, dp.voice_style,
        dp.persona_config, dp.tts_provider, dp.tts_voice_id
      FROM dj_daypart_assignments da
      JOIN dj_profiles dp ON dp.id = da.dj_profile_id AND dp.is_active = true
      WHERE da.station_id = $1
      ORDER BY dp.name ASC
    `, [st.id]);

    const primaryDj = djRows[0];

    return {
      id: st.id,
      name: st.name,
      slug: st.slug,
      description: st.tagline ?? '',
      streamUrl: '',
      metadataUrl: '',
      genre: '',
      artworkUrl: st.logo_url ?? null,
      isLive: st.dj_enabled ?? false,
      status: st.dj_enabled ? 'on_air' : 'off_air',
      dj: primaryDj ? {
        id: primaryDj.id,
        name: primaryDj.name,
        bio: primaryDj.personality ?? '',
        avatarUrl: null,
        personality: primaryDj.persona_config?.backstory ?? null,
      } : null,
      djs: djRows.map(d => ({
        id: d.id,
        name: d.name,
        bio: d.personality ?? '',
        avatarUrl: null,
      })),
      currentSong: null,
      listenerCount: 0,
      songs: [],
    };
  });
}
