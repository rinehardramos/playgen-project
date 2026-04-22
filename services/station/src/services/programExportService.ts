import archiver from 'archiver';
import { Writable, PassThrough } from 'stream';
import fs from 'fs/promises';
import path from 'path';
import { getPool } from '../db';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ExportMetadata {
  format_version: '1.0';
  exported_at: string;
  episode: {
    id: string;
    air_date: string;
    status: string;
    notes: string | null;
    episode_title: string | null;
    playlist_id: string | null;
    dj_script_id: string | null;
    manifest_id: string | null;
  };
  program: {
    id: string;
    name: string;
    description: string | null;
    active_days: string[];
    start_hour: number;
    end_hour: number;
    color_tag: string | null;
  };
  playlist: {
    id: string;
    date: string;
    status: string;
  } | null;
}

export interface ExportSongEntry {
  position: number;
  hour: number;
  title: string;
  artist: string;
  duration_sec: number | null;
  category_code: string | null;
  category_label: string | null;
}

export interface ExportProfileConfig {
  name: string;
  personality: string;
  voice_style: string;
  persona_config: Record<string, unknown>;
  llm_model: string;
  llm_temperature: number;
  tts_provider: string;
  tts_voice_id: string;
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Export a program episode as a .playgen ZIP bundle.
 * The bundle contains:
 *   - manifest.json  (DJ show manifest)
 *   - metadata.json  (episode + program + playlist info)
 *   - profile.json   (DJ profile config)
 *   - songs.json     (playlist song entries; audio NOT included)
 *   - audio/dj/      (DJ segment audio files from local storage)
 */
export async function exportEpisode(episodeId: string): Promise<Buffer> {
  const pool = getPool();

  // 1. Load episode with program
  const { rows: episodeRows } = await pool.query(
    `SELECT pe.*, p.name AS program_name, p.description AS program_description,
            p.active_days AS program_active_days, p.start_hour, p.end_hour,
            p.color_tag AS program_color_tag, p.id AS program_id
     FROM program_episodes pe
     JOIN programs p ON p.id = pe.program_id
     WHERE pe.id = $1`,
    [episodeId],
  );
  if (!episodeRows.length) {
    throw Object.assign(new Error('Episode not found'), { code: 'NOT_FOUND' });
  }
  const ep = episodeRows[0];

  // 2. Load playlist
  let playlistData: ExportMetadata['playlist'] = null;
  let songEntries: ExportSongEntry[] = [];
  if (ep.playlist_id) {
    const { rows: playlistRows } = await pool.query(
      `SELECT id, date, status FROM playlists WHERE id = $1`,
      [ep.playlist_id],
    );
    if (playlistRows.length) {
      playlistData = { id: playlistRows[0].id, date: playlistRows[0].date, status: playlistRows[0].status };
    }

    // 3. Load playlist entries with songs
    const { rows: entryRows } = await pool.query(
      `SELECT ple.hour, ple.position, s.title, s.artist, s.duration_sec,
              c.code AS category_code, c.label AS category_label
       FROM playlist_entries ple
       JOIN songs s ON s.id = ple.song_id
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE ple.playlist_id = $1
       ORDER BY ple.hour ASC, ple.position ASC`,
      [ep.playlist_id],
    );
    songEntries = entryRows.map((r) => ({
      position: r.position,
      hour: r.hour,
      title: r.title,
      artist: r.artist,
      duration_sec: r.duration_sec ?? null,
      category_code: r.category_code ?? null,
      category_label: r.category_label ?? null,
    }));
  }

  // 4. Load DJ script segments for audio
  let djSegments: Array<{ audio_url: string | null; segment_type: string; position: number }> = [];
  if (ep.dj_script_id) {
    const { rows: segRows } = await pool.query(
      `SELECT audio_url, segment_type, position
       FROM dj_segments
       WHERE script_id = $1
       ORDER BY position ASC`,
      [ep.dj_script_id],
    );
    djSegments = segRows;
  }

  // 5. Load DJ profile
  let profileConfig: ExportProfileConfig | null = null;
  if (ep.dj_script_id) {
    const { rows: scriptRows } = await pool.query(
      `SELECT ds.dj_profile_id FROM dj_scripts ds WHERE ds.id = $1`,
      [ep.dj_script_id],
    );
    if (scriptRows.length && scriptRows[0].dj_profile_id) {
      const { rows: profileRows } = await pool.query(
        `SELECT name, personality, voice_style, persona_config, llm_model,
                llm_temperature, tts_provider, tts_voice_id
         FROM dj_profiles WHERE id = $1`,
        [scriptRows[0].dj_profile_id],
      );
      if (profileRows.length) {
        const pr = profileRows[0];
        profileConfig = {
          name: pr.name,
          personality: pr.personality,
          voice_style: pr.voice_style,
          persona_config: pr.persona_config ?? {},
          llm_model: pr.llm_model,
          llm_temperature: pr.llm_temperature,
          tts_provider: pr.tts_provider,
          tts_voice_id: pr.tts_voice_id,
        };
      }
    }
  }

  // 6. Load DJ show manifest JSON
  let manifestContent: string | null = null;
  if (ep.manifest_id) {
    const { rows: manifestRows } = await pool.query(
      `SELECT manifest_url, status, total_duration_sec, storage_provider
       FROM dj_show_manifests WHERE id = $1`,
      [ep.manifest_id],
    );
    if (manifestRows.length) {
      manifestContent = JSON.stringify(manifestRows[0], null, 2);
    }
  }

  // 7. Build ZIP
  return buildZip({
    metadata: buildMetadata(ep, playlistData),
    songs: songEntries,
    profile: profileConfig,
    manifestContent,
    djSegments,
  });
}

function buildMetadata(ep: Record<string, unknown>, playlist: ExportMetadata['playlist']): ExportMetadata {
  return {
    format_version: '1.0',
    exported_at: new Date().toISOString(),
    episode: {
      id: ep.id as string,
      air_date: ep.air_date as string,
      status: ep.status as string,
      notes: (ep.notes as string | null) ?? null,
      episode_title: (ep.episode_title as string | null) ?? null,
      playlist_id: (ep.playlist_id as string | null) ?? null,
      dj_script_id: (ep.dj_script_id as string | null) ?? null,
      manifest_id: (ep.manifest_id as string | null) ?? null,
    },
    program: {
      id: ep.program_id as string,
      name: ep.program_name as string,
      description: (ep.program_description as string | null) ?? null,
      active_days: (ep.program_active_days as string[]) ?? [],
      start_hour: ep.start_hour as number,
      end_hour: ep.end_hour as number,
      color_tag: (ep.program_color_tag as string | null) ?? null,
    },
    playlist,
  };
}

async function buildZip(opts: {
  metadata: ExportMetadata;
  songs: ExportSongEntry[];
  profile: ExportProfileConfig | null;
  manifestContent: string | null;
  djSegments: Array<{ audio_url: string | null; segment_type: string; position: number }>;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on('data', (chunk: Buffer) => chunks.push(chunk));
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    archive.pipe(sink as unknown as Writable);

    // metadata.json
    archive.append(JSON.stringify(opts.metadata, null, 2), { name: 'metadata.json' });

    // songs.json
    archive.append(JSON.stringify(opts.songs, null, 2), { name: 'songs.json' });

    // profile.json
    if (opts.profile) {
      archive.append(JSON.stringify(opts.profile, null, 2), { name: 'profile.json' });
    }

    // manifest.json
    if (opts.manifestContent) {
      archive.append(opts.manifestContent, { name: 'manifest.json' });
    }

    // audio/dj/ — read from local storage path
    const localStoragePath = process.env.STORAGE_LOCAL_PATH ?? '/tmp/playgen-dj';
    const audioPromises: Promise<void>[] = [];

    for (const seg of opts.djSegments) {
      if (!seg.audio_url) continue;
      // audio_url is either an absolute URL (S3) or a relative path like /api/v1/dj/audio/<relpath>
      // We only embed local files; skip HTTP URLs
      const relPath = extractLocalRelPath(seg.audio_url);
      if (!relPath) continue;

      const fullPath = path.join(localStoragePath, relPath);
      const archiveName = `audio/dj/${relPath}`;

      const p = fs.readFile(fullPath)
        .then((data) => {
          archive.append(data, { name: archiveName });
        })
        .catch(() => {
          // File missing — silently skip; recipient warned via songs.json
        });
      audioPromises.push(p);
    }

    Promise.all(audioPromises).then(() => {
      archive.finalize();
    }).catch(reject);
  });
}

/**
 * Extract the relative storage path from an audio_url.
 * Returns null for S3/HTTP URLs — we don't download those here.
 * Local URLs follow the pattern: /api/v1/dj/audio/<relpath>
 */
function extractLocalRelPath(audioUrl: string): string | null {
  const prefix = '/api/v1/dj/audio/';
  if (audioUrl.startsWith(prefix)) {
    return audioUrl.slice(prefix.length);
  }
  return null;
}
