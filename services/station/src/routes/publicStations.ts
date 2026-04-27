/**
 * Public stations endpoint — no auth required.
 * Returns station + DJ data for the OwnRadio frontend and any public consumer.
 */
import type { FastifyInstance } from 'fastify';
import { getPool } from '../db';

interface DjRow {
  id: string;
  name: string;
  personality: string | null;
  voice_style: string | null;
  persona_config: Record<string, unknown> | null;
  tts_provider: string | null;
  tts_voice_id: string | null;
  station_id: string;
}

function formatDj(d: DjRow) {
  return {
    id: d.id,
    name: d.name,
    bio: d.personality ?? '',
    avatarUrl: null,
    personality: (d.persona_config as Record<string, unknown>)?.backstory ?? null,
  };
}

export async function publicStationRoutes(app: FastifyInstance) {
  // GET /public/stations — list all active stations with all assigned DJs
  app.get('/public/stations', async () => {
    const pool = getPool();

    const { rows: stations } = await pool.query(`
      SELECT id, name, slug, timezone, locale_code, city, country_code,
        callsign, tagline, frequency, is_active, dj_enabled,
        logo_url, primary_color, secondary_color
      FROM stations
      WHERE is_active = true AND slug IS NOT NULL
      ORDER BY name ASC
    `);

    if (stations.length === 0) return [];

    // Batch-load all DJs assigned to these stations via daypart assignments
    const stationIds = stations.map(s => s.id);
    const { rows: djRows } = await pool.query<DjRow>(`
      SELECT DISTINCT ON (da.station_id, dp.id)
        dp.id, dp.name, dp.personality, dp.voice_style,
        dp.persona_config, dp.tts_provider, dp.tts_voice_id,
        da.station_id
      FROM dj_daypart_assignments da
      JOIN dj_profiles dp ON dp.id = da.dj_profile_id AND dp.is_active = true
      WHERE da.station_id = ANY($1)
      ORDER BY da.station_id, dp.id
    `, [stationIds]);

    // Group DJs by station
    const djsByStation = new Map<string, DjRow[]>();
    for (const dj of djRows) {
      const list = djsByStation.get(dj.station_id) ?? [];
      list.push(dj);
      djsByStation.set(dj.station_id, list);
    }

    return stations.map(s => {
      const djs = djsByStation.get(s.id) ?? [];
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.tagline ?? '',
        streamUrl: '',
        metadataUrl: '',
        genre: '',
        artworkUrl: s.logo_url ?? null,
        isLive: s.dj_enabled ?? false,
        status: s.dj_enabled ? 'on_air' : 'off_air',
        dj: djs[0] ? formatDj(djs[0]) : null,
        djs: djs.map(formatDj),
        currentSong: null,
        listenerCount: 0,
      };
    });
  });

  // GET /public/stations/:slug — single station by slug with all DJs
  app.get<{ Params: { slug: string } }>('/public/stations/:slug', async (req, reply) => {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT id, name, slug, timezone, locale_code, city, country_code,
        callsign, tagline, frequency, is_active, dj_enabled,
        logo_url, primary_color, secondary_color
      FROM stations
      WHERE slug = $1 AND is_active = true
    `, [req.params.slug]);

    if (!rows[0]) return reply.status(404).send({ error: 'Station not found' });
    const st = rows[0];

    const { rows: djRows } = await pool.query<DjRow>(`
      SELECT DISTINCT ON (dp.id)
        dp.id, dp.name, dp.personality, dp.voice_style,
        dp.persona_config, dp.tts_provider, dp.tts_voice_id,
        da.station_id
      FROM dj_daypart_assignments da
      JOIN dj_profiles dp ON dp.id = da.dj_profile_id AND dp.is_active = true
      WHERE da.station_id = $1
      ORDER BY dp.id
    `, [st.id]);

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
      dj: djRows[0] ? formatDj(djRows[0]) : null,
      djs: djRows.map(formatDj),
      currentSong: null,
      listenerCount: 0,
      songs: [],
    };
  });
}
