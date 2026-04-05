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
    `SELECT pe.id, pe.hour, pe.position, s.title, s.artist, s.duration_sec
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
