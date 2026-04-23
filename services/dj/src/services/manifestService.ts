import { getPool } from '../db.js';
import { getStorageAdapter } from '../lib/storage/index.js';

export interface ManifestItem {
  type: 'song' | 'dj_segment';
  id: string;
  hour?: number;
  position?: number;
  title?: string;
  artist?: string;
  file_path?: string;
  duration_ms: number;
  cumulative_ms: number;
}

export interface ProgramManifestSegment {
  position: number;
  type: 'song' | 'dj_segment' | 'station_id' | 'weather' | 'news' | 'joke' | 'ad_break' | 'time_check' | 'adlib' | 'listener_activity';
  segment_type?: string;
  start_sec: number;
  duration_sec: number;
  audio_url: string | null;
  script_text?: string;
  song?: { id: string; title: string; artist: string };
  dj_profile?: { name: string };
  metadata: { title: string; artist: string };
}

export interface ProgramManifest {
  version: 1;
  station_id: string;
  episode_id: string;
  air_date: string;
  dj_profile?: { id: string; name: string; voice_style: string };
  total_duration_sec: number;
  segments: ProgramManifestSegment[];
}

export interface ShowManifest {
  total_duration_ms: number;
  items: ManifestItem[];
}

export async function buildManifest(scriptId: string): Promise<string> {
  const pool = getPool();

  // 1. Get script and segments
  const { rows: scriptRows } = await pool.query(
    `SELECT s.*, st.company_id FROM dj_scripts s
     JOIN stations st ON st.id = s.station_id
     WHERE s.id = $1`,
    [scriptId]
  );
  const script = scriptRows[0];
  if (!script) throw new Error('Script not found');

  const { rows: segments } = await pool.query(
    `SELECT * FROM dj_segments WHERE script_id = $1 ORDER BY position`,
    [scriptId]
  );

  // 2. Get playlist entries
  const { rows: entries } = await pool.query(
    `SELECT pe.id, pe.hour, pe.position, s.title, s.artist, s.duration_sec, s.audio_url
     FROM playlist_entries pe
     JOIN songs s ON s.id = pe.song_id
     WHERE pe.playlist_id = $1
     ORDER BY pe.hour, pe.position`,
    [script.playlist_id]
  );

  // 3. Interleave — track cumulative timing in milliseconds
  const items: ManifestItem[] = [];
  let cumulativeMs = 0;

  const audioPrefix = '/api/v1/dj/audio/';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Find segments associated with this entry
    const entrySegments = segments.filter(s => s.playlist_entry_id === entry.id);

    // show_intro and song_intro/transition come BEFORE the song
    const beforeSegments = entrySegments.filter(s => s.segment_type !== 'show_outro');
    for (const seg of beforeSegments) {
      if (seg.audio_url) {
        const durationMs = Math.round((parseFloat(seg.audio_duration_sec) || 0) * 1000);
        const filePath = seg.audio_url.startsWith(audioPrefix)
          ? seg.audio_url.substring(audioPrefix.length)
          : seg.audio_url;
        items.push({
          type: 'dj_segment',
          id: seg.id,
          title: `DJ: ${seg.segment_type}`,
          file_path: filePath,
          duration_ms: durationMs,
          cumulative_ms: cumulativeMs,
        });
        cumulativeMs += durationMs;
      }
    }

    // The song itself
    const songDurationMs = Math.round((entry.duration_sec || 0) * 1000);
    items.push({
      type: 'song',
      id: entry.id,
      hour: entry.hour,
      position: entry.position,
      title: entry.title,
      artist: entry.artist,
      ...(entry.audio_url ? { file_path: entry.audio_url } : {}),
      duration_ms: songDurationMs,
      cumulative_ms: cumulativeMs,
    });
    cumulativeMs += songDurationMs;

    // show_outro comes AFTER the very last song
    if (i === entries.length - 1) {
      const afterSegments = entrySegments.filter(s => s.segment_type === 'show_outro');
      for (const seg of afterSegments) {
        if (seg.audio_url) {
          const durationMs = Math.round((parseFloat(seg.audio_duration_sec) || 0) * 1000);
          const filePath = seg.audio_url.startsWith(audioPrefix)
            ? seg.audio_url.substring(audioPrefix.length)
            : seg.audio_url;
          items.push({
            type: 'dj_segment',
            id: seg.id,
            title: 'DJ: Show Outro',
            file_path: filePath,
            duration_ms: durationMs,
            cumulative_ms: cumulativeMs,
          });
          cumulativeMs += durationMs;
        }
      }
    }
  }

  // 4. Save to dj_show_manifests
  const storage = getStorageAdapter();
  const totalDurationSec = cumulativeMs / 1000;
  const manifestPayload: ShowManifest = { total_duration_ms: cumulativeMs, items };
  const manifestPath = `${script.company_id}/${script.station_id}/${script.id}_manifest.json`;

  await storage.write(manifestPath, Buffer.from(JSON.stringify(manifestPayload)));
  const manifestUrl = storage.getPublicUrl(manifestPath);

  const { rows: manifestRows } = await pool.query(
    `INSERT INTO dj_show_manifests (script_id, station_id, status, manifest_url, total_duration_sec, built_at)
     VALUES ($1, $2, 'ready', $3, $4, NOW())
     ON CONFLICT (script_id) DO UPDATE SET
       status = 'ready', manifest_url = $3, total_duration_sec = $4, built_at = NOW(), updated_at = NOW()
     RETURNING id`,
    [scriptId, script.station_id, manifestUrl, totalDurationSec]
  );

  return manifestRows[0].id;
}

export async function getManifestByScript(scriptId: string) {
  const { rows } = await getPool().query(
    `SELECT * FROM dj_show_manifests WHERE script_id = $1`,
    [scriptId]
  );
  return rows[0] || null;
}

/**
 * Build a full program manifest for an episode, including song audio URLs
 * and all segment types (DJ, weather, news, jokes, station IDs, ads, etc.).
 *
 * This is the enhanced version used by the Publish feature to produce a
 * complete, streamable program for OwnRadio consumption.
 */
export async function buildProgramManifest(episodeId: string): Promise<ProgramManifest> {
  const pool = getPool();

  // 1. Load episode with program and DJ profile
  const { rows: [episode] } = await pool.query(
    `SELECT pe.*, p.name AS program_name, p.start_hour, p.end_hour, p.dj_profile_id,
            dp.name AS dj_name, dp.voice_style AS dj_voice_style
     FROM program_episodes pe
     JOIN programs p ON p.id = pe.program_id
     LEFT JOIN dj_profiles dp ON dp.id = p.dj_profile_id
     WHERE pe.id = $1`,
    [episodeId],
  );
  if (!episode) throw new Error(`Episode ${episodeId} not found`);

  // 2. Load playlist entries with song audio
  const { rows: entries } = await pool.query(
    `SELECT pe.id, pe.hour, pe.position, s.id AS song_id, s.title, s.artist,
            s.duration_sec, s.audio_url AS song_audio_url
     FROM playlist_entries pe
     JOIN songs s ON s.id = pe.song_id
     WHERE pe.playlist_id = $1
     ORDER BY pe.hour, pe.position`,
    [episode.playlist_id],
  );

  // 3. Load DJ segments (both playlist-bound and standalone)
  const { rows: segments } = await pool.query(
    `SELECT ds.*, ds.edited_text AS display_text
     FROM dj_segments ds
     WHERE ds.script_id = $1
     ORDER BY ds.position`,
    [episode.dj_script_id],
  );

  // 4. Build segment map: playlist_entry_id -> segments
  const entrySegmentMap = new Map<string, typeof segments>();
  const standaloneSegments: typeof segments = [];
  for (const seg of segments) {
    if (seg.playlist_entry_id) {
      const list = entrySegmentMap.get(seg.playlist_entry_id) || [];
      list.push(seg);
      entrySegmentMap.set(seg.playlist_entry_id, list);
    } else {
      standaloneSegments.push(seg);
    }
  }

  // 5. Interleave into ordered manifest
  const manifestSegments: ProgramManifestSegment[] = [];
  let cumulativeSec = 0;
  let pos = 0;

  const addSegment = (seg: ProgramManifestSegment) => {
    manifestSegments.push(seg);
    cumulativeSec += seg.duration_sec;
    pos++;
  };

  // Insert standalone segments that belong before any song (show_intro, station_id at position 0, etc.)
  const preShowSegments = standaloneSegments.filter(s =>
    s.segment_type === 'show_intro' || s.segment_type === 'station_id' && s.position === 0,
  );
  for (const seg of preShowSegments) {
    addSegment(makeSegmentEntry(seg, pos, cumulativeSec, episode.dj_name));
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entrySegs = entrySegmentMap.get(entry.id) || [];

    // DJ segments before the song (intro, transition, weather, etc.)
    const beforeSegs = entrySegs.filter(s => s.segment_type !== 'show_outro');
    for (const seg of beforeSegs) {
      addSegment(makeSegmentEntry(seg, pos, cumulativeSec, episode.dj_name));
    }

    // The song itself
    const songDuration = entry.duration_sec || 0;
    addSegment({
      position: pos,
      type: 'song',
      start_sec: cumulativeSec,
      duration_sec: songDuration,
      audio_url: entry.song_audio_url,
      song: { id: entry.song_id, title: entry.title, artist: entry.artist },
      metadata: { title: entry.title, artist: entry.artist },
    });

    // show_outro after last song
    if (i === entries.length - 1) {
      const outroSegs = entrySegs.filter(s => s.segment_type === 'show_outro');
      for (const seg of outroSegs) {
        addSegment(makeSegmentEntry(seg, pos, cumulativeSec, episode.dj_name));
      }
    }
  }

  // Add remaining standalone segments (those not already added)
  const usedIds = new Set(preShowSegments.map(s => s.id));
  for (const seg of standaloneSegments) {
    if (!usedIds.has(seg.id)) {
      addSegment(makeSegmentEntry(seg, pos, cumulativeSec, episode.dj_name));
    }
  }

  const manifest: ProgramManifest = {
    version: 1,
    station_id: episode.station_id || '',
    episode_id: episodeId,
    air_date: episode.air_date,
    dj_profile: episode.dj_profile_id ? {
      id: episode.dj_profile_id,
      name: episode.dj_name || 'DJ',
      voice_style: episode.dj_voice_style || 'energetic',
    } : undefined,
    total_duration_sec: cumulativeSec,
    segments: manifestSegments,
  };

  // 6. Save manifest to storage
  const storage = getStorageAdapter();
  const manifestPath = `manifests/${episodeId}.json`;
  await storage.write(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2)));
  const manifestUrl = storage.getPublicUrl(manifestPath);

  // 7. Update or create dj_show_manifests record
  if (episode.dj_script_id) {
    await pool.query(
      `INSERT INTO dj_show_manifests (script_id, station_id, status, manifest_url, total_duration_sec, built_at)
       VALUES ($1, $2, 'ready', $3, $4, NOW())
       ON CONFLICT (script_id) DO UPDATE SET
         status = 'ready', manifest_url = $3, total_duration_sec = $4, built_at = NOW(), updated_at = NOW()`,
      [episode.dj_script_id, manifest.station_id, manifestUrl, cumulativeSec],
    );
  }

  // 8. Link manifest to episode
  const { rows: [manifestRow] } = await pool.query(
    `SELECT id FROM dj_show_manifests WHERE script_id = $1`,
    [episode.dj_script_id],
  );
  if (manifestRow) {
    await pool.query(
      `UPDATE program_episodes SET manifest_id = $1, updated_at = NOW() WHERE id = $2`,
      [manifestRow.id, episodeId],
    );
  }

  return manifest;
}

/** Map a DJ segment DB row to a ProgramManifestSegment. */
function makeSegmentEntry(
  seg: Record<string, unknown>,
  position: number,
  startSec: number,
  djName?: string,
): ProgramManifestSegment {
  const segType = seg.segment_type as string;
  const durationSec = parseFloat(String(seg.audio_duration_sec || 0));
  const displayText = (seg.display_text || seg.script_text || '') as string;

  // Map segment_type to manifest type
  const typeMap: Record<string, ProgramManifestSegment['type']> = {
    show_intro: 'dj_segment',
    show_outro: 'dj_segment',
    song_intro: 'dj_segment',
    song_transition: 'dj_segment',
    station_id: 'station_id',
    time_check: 'time_check',
    weather_tease: 'weather',
    current_events: 'news',
    joke: 'joke',
    ad_break: 'ad_break',
    adlib: 'adlib',
    listener_activity: 'listener_activity',
  };

  return {
    position,
    type: typeMap[segType] || 'dj_segment',
    segment_type: segType,
    start_sec: startSec,
    duration_sec: durationSec,
    audio_url: (seg.audio_url as string) || null,
    script_text: displayText || undefined,
    dj_profile: djName ? { name: djName } : undefined,
    metadata: {
      title: `${segType.replace(/_/g, ' ')}`,
      artist: djName || 'DJ',
    },
  };
}
