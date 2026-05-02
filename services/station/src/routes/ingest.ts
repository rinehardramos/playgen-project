/**
 * POST /stations/ingest-external
 *
 * Accepts a fully-generated radio program produced by the local PlayGen stack
 * and upserts all records into this (production) database.
 *
 * Intended for the local→production sync workflow:
 *   local generate → upload audio to R2 → POST here with R2 audio URLs
 *
 * Auth: requires a valid JWT. Caller is typically the sync-program script (admin creds).
 */
import type { FastifyInstance } from 'fastify';
import { authenticate } from '@playgen/middleware';
import { getPool } from '../db';
import { notifyStreamUrlChange } from '../services/streamControlNotifier';

export interface ExternalSegment {
  segment_type: string;
  position: number;
  script_text: string;
  /** Index into playlist.entries[] for song-linked segments; null for non-song segments */
  playlist_entry_ref?: number | null;
  /** R2 / CDN audio URL; null if TTS not generated */
  audio_url: string | null;
  audio_duration_sec: number | null;
  /** Speaker tag for dual-DJ scripts: 'dj1', 'dj2', or null */
  speaker?: string | null;
  /** Voice ID used for TTS (per-segment override for dual-DJ) */
  tts_voice_id?: string | null;
}

export interface ExternalProgramPayload {
  station: {
    slug: string;
    name: string;
    timezone: string;
    locale_code?: string | null;
    city?: string | null;
    country_code?: string | null;
    callsign?: string | null;
    tagline?: string | null;
    frequency?: string | null;
    /** CDN URL for station cover art (e.g. R2-hosted image) */
    artwork_url?: string | null;
  };
  dj_profile: {
    name: string;
    personality: string;
    voice_style: string;
    persona_config?: Record<string, unknown>;
    llm_model?: string;
    tts_provider?: string;
    tts_voice_id?: string;
  };
  playlist: {
    date: string; // YYYY-MM-DD
    entries: Array<{
      hour: number;
      position: number;
      song_title: string;
      song_artist: string;
      duration_sec?: number | null;
      audio_url?: string | null;
    }>;
  };
  script: {
    generation_source?: string;
    llm_model?: string;
    review_status?: string;
    segments: ExternalSegment[];
  };
  /** HLS playlist URL (R2 public URL) to push to OwnRadio after ingest */
  stream_url?: string | null;
}

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.post<{ Body: ExternalProgramPayload }>(
    '/stations/ingest-external',
    async (req, reply) => {
      const pool = getPool();
      const {
        station: stationData,
        dj_profile: profileData,
        playlist: playlistData,
        script: scriptData,
        stream_url,
      } = req.body;

      if (!stationData?.slug) return reply.badRequest('station.slug is required');
      if (!playlistData?.date) return reply.badRequest('playlist.date is required');
      if (!Array.isArray(scriptData?.segments)) return reply.badRequest('script.segments must be an array');

      // ── 1. Resolve company_id from authenticated user ──────────────────
      // req.user.cid is the company_id stamped in the JWT by the auth service
      const company_id = req.user.cid;
      if (!company_id) return reply.badRequest('Cannot resolve company_id for authenticated user');

      // ── 2. Upsert station by slug ─────────────────────────────────────
      const { rows: stationRows } = await pool.query<{ id: string }>(
        `INSERT INTO stations
           (company_id, name, slug, timezone, locale_code, city, country_code,
            callsign, tagline, frequency, is_active, dj_enabled, artwork_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, true, $11)
         ON CONFLICT (company_id, slug) WHERE slug IS NOT NULL
         DO UPDATE SET
           name         = EXCLUDED.name,
           timezone     = EXCLUDED.timezone,
           locale_code  = EXCLUDED.locale_code,
           city         = EXCLUDED.city,
           country_code = EXCLUDED.country_code,
           callsign     = EXCLUDED.callsign,
           tagline      = EXCLUDED.tagline,
           frequency    = EXCLUDED.frequency,
           dj_enabled   = true,
           artwork_url  = COALESCE(EXCLUDED.artwork_url, stations.artwork_url),
           updated_at   = NOW()
         RETURNING id`,
        [
          company_id,
          stationData.name,
          stationData.slug,
          stationData.timezone,
          stationData.locale_code ?? null,
          stationData.city ?? null,
          stationData.country_code ?? null,
          stationData.callsign ?? null,
          stationData.tagline ?? null,
          stationData.frequency ?? null,
          stationData.artwork_url ?? null,
        ],
      );
      const station_id = stationRows[0].id;

      // ── 3. Upsert DJ profile by (company_id, name) ───────────────────
      const { rows: profileRows } = await pool.query<{ id: string }>(
        `INSERT INTO dj_profiles
           (company_id, name, personality, voice_style, persona_config,
            llm_model, tts_provider, tts_voice_id, is_default, is_active)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, false, true)
         ON CONFLICT (company_id, name)
         DO UPDATE SET
           personality  = EXCLUDED.personality,
           voice_style  = EXCLUDED.voice_style,
           persona_config = EXCLUDED.persona_config,
           llm_model    = EXCLUDED.llm_model,
           tts_provider = EXCLUDED.tts_provider,
           tts_voice_id = EXCLUDED.tts_voice_id,
           updated_at   = NOW()
         RETURNING id`,
        [
          company_id,
          profileData.name,
          profileData.personality,
          profileData.voice_style,
          JSON.stringify(profileData.persona_config ?? {}),
          profileData.llm_model ?? 'claude-code',
          profileData.tts_provider ?? 'mistral',
          profileData.tts_voice_id ?? 'energetic_female',
        ],
      );
      const dj_profile_id = profileRows[0].id;

      // ── 3b. Assign DJ to station dayparts (idempotent) ───────────────
      // Creates a 'morning' daypart if no assignment exists for this station+DJ
      await pool.query(
        `INSERT INTO dj_daypart_assignments (station_id, dj_profile_id, daypart, start_hour, end_hour)
         VALUES ($1, $2, 'morning', 6, 12)
         ON CONFLICT (station_id, daypart) DO UPDATE SET dj_profile_id = EXCLUDED.dj_profile_id`,
        [station_id, dj_profile_id],
      );

      // ── 4. Resolve default category for song upserts ──────────────────
      // Songs require a category_id. Use the first active category for the station,
      // creating a default one if this is a freshly-synced station with none yet.
      let { rows: catRows } = await pool.query<{ id: string }>(
        `SELECT id FROM categories WHERE station_id = $1 ORDER BY created_at LIMIT 1`,
        [station_id],
      );
      if (!catRows[0]) {
        const { rows: newCat } = await pool.query<{ id: string }>(
          `INSERT INTO categories (station_id, code, label, rotation_weight)
           VALUES ($1, 'GEN', 'General', 1.0)
           ON CONFLICT (station_id, code) DO UPDATE SET label = EXCLUDED.label
           RETURNING id`,
          [station_id],
        );
        catRows = newCat;
      }
      const category_id = catRows[0].id;

      // ── 5. Upsert songs + build playlist ─────────────────────────────
      const songIds: string[] = [];
      for (const entry of playlistData.entries) {
        const { rows: songRows } = await pool.query<{ id: string }>(
          `INSERT INTO songs (company_id, station_id, category_id, title, artist, duration_sec, audio_url, audio_source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (station_id, title, artist)
           DO UPDATE SET
             duration_sec = COALESCE(EXCLUDED.duration_sec, songs.duration_sec),
             audio_url    = COALESCE(EXCLUDED.audio_url, songs.audio_url),
             audio_source = COALESCE(EXCLUDED.audio_source, songs.audio_source),
             updated_at   = NOW()
           RETURNING id`,
          [
            company_id, station_id, category_id,
            entry.song_title, entry.song_artist, entry.duration_sec ?? null,
            entry.audio_url ?? null,
            entry.audio_url ? 'upload' : null,
          ],
        );
        songIds.push(songRows[0].id);
      }

      // Upsert playlist (unique on station_id + date)
      const { rows: playlistRows } = await pool.query<{ id: string }>(
        `INSERT INTO playlists (station_id, date, status)
         VALUES ($1, $2, 'approved')
         ON CONFLICT (station_id, date)
         DO UPDATE SET status = 'approved'
         RETURNING id`,
        [station_id, playlistData.date],
      );
      const playlist_id = playlistRows[0].id;

      // Delete ALL existing scripts for this station (cascades to dj_segments).
      // This ensures old scripts with stale audio formats (e.g., MP3 before AAC migration)
      // don't persist and get picked by the stream query over the new ones.
      await pool.query(`DELETE FROM dj_scripts WHERE station_id = $1`, [station_id]);

      // Replace playlist entries with the synced set
      await pool.query(`DELETE FROM playlist_entries WHERE playlist_id = $1`, [playlist_id]);
      for (let i = 0; i < playlistData.entries.length; i++) {
        const entry = playlistData.entries[i];
        await pool.query(
          `INSERT INTO playlist_entries (playlist_id, song_id, hour, position)
           VALUES ($1, $2, $3, $4)`,
          [playlist_id, songIds[i], entry.hour, entry.position],
        );
      }

      // Fetch entry IDs in order (for segment linking via playlist_entry_ref index)
      const { rows: entryRows } = await pool.query<{ id: string }>(
        `SELECT id FROM playlist_entries WHERE playlist_id = $1 ORDER BY hour, position`,
        [playlist_id],
      );

      // ── 6. Insert script ──────────────────────────────────────────────
      const { rows: scriptRows } = await pool.query<{ id: string }>(
        `INSERT INTO dj_scripts
           (playlist_id, station_id, dj_profile_id, review_status, llm_model,
            total_segments, generation_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          playlist_id,
          station_id,
          dj_profile_id,
          scriptData.review_status ?? 'auto_approved',
          scriptData.llm_model ?? 'claude-code',
          scriptData.segments.length,
          scriptData.generation_source ?? 'external',
        ],
      );
      const script_id = scriptRows[0].id;

      // ── 7. Insert segments ────────────────────────────────────────────
      for (const seg of scriptData.segments) {
        const playlist_entry_id =
          seg.playlist_entry_ref != null ? (entryRows[seg.playlist_entry_ref]?.id ?? null) : null;

        await pool.query(
          `INSERT INTO dj_segments
             (script_id, playlist_entry_id, segment_type, position,
              script_text, audio_url, audio_duration_sec, speaker, tts_voice_id,
              segment_review_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved')`,
          [
            script_id,
            playlist_entry_id,
            seg.segment_type,
            seg.position,
            seg.script_text,
            seg.audio_url ?? null,
            seg.audio_duration_sec ?? null,
            seg.speaker ?? null,
            seg.tts_voice_id ?? null,
          ],
        );
      }

      // ── 8. Auto-register station in OwnRadio + notify stream URL ──────
      const ownradioUrl = process.env.OWNRADIO_WEBHOOK_URL;
      const webhookSecret = process.env.PLAYGEN_WEBHOOK_SECRET;
      const gatewayUrl = process.env.GATEWAY_URL ?? process.env.PROD_GATEWAY_URL ?? 'https://api.playgen.site';
      const stationStreamUrl = stream_url ?? `${gatewayUrl}/stream/${station_id}/playlist.m3u8`;

      // Persist stream_url on the station record so public API can return it
      await pool.query(
        `UPDATE stations SET stream_url = $1, updated_at = NOW() WHERE id = $2`,
        [stationStreamUrl, station_id],
      );

      if (ownradioUrl && stationData.slug) {
        // Upsert station in OwnRadio (creates if not exists, updates if exists)
        fetch(`${ownradioUrl}/stations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(webhookSecret ? { 'X-PlayGen-Secret': webhookSecret } : {}),
          },
          body: JSON.stringify({
            slug: stationData.slug,
            name: stationData.name,
            streamUrl: stationStreamUrl,
            metadataUrl: `${gatewayUrl}/stream/${station_id}/status.json`,
            genre: 'OPM',
            isLive: true,
            ...(stationData.artwork_url ? { artworkUrl: stationData.artwork_url } : {}),
          }),
        }).catch((err: unknown) =>
          req.log.warn({ err }, 'OwnRadio station upsert failed'),
        );

        // Notify stream URL change
        notifyStreamUrlChange(stationData.slug, stationStreamUrl).catch((err: unknown) =>
          req.log.warn({ err }, 'OwnRadio notify failed after ingest'),
        );
      }

      reply.code(201);
      return {
        station_id,
        dj_profile_id,
        playlist_id,
        script_id,
        segment_count: scriptData.segments.length,
        slug: stationData.slug,
        ownradio_notified: !!stream_url,
      };
    },
  );
}
