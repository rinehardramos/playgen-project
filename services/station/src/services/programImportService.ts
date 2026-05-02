import unzipper from 'unzipper';
import path from 'path';
import fs from 'fs/promises';
import type { PoolClient } from 'pg';
import { getPool } from '../db';
import type {
  ExportMetadata,
  ExportSongEntry,
  ExportProfileConfig,
} from './programExportService';

// ─── Import ───────────────────────────────────────────────────────────────────

export interface ImportResult {
  episodeId: string;
  warnings: string[];
}

/**
 * Import a .playgen ZIP bundle into the given station.
 *
 * Steps:
 *  1. Extract ZIP entries into memory.
 *  2. Read metadata.json → create/find program + create episode.
 *  3. Read profile.json → create DJ profile if not exists (match by name).
 *  4. Read songs.json → match songs by title+artist (warn on missing).
 *  5. Read manifest.json → store as dj_show_manifest record.
 *  6. Copy audio/dj/ files to local storage.
 *  7. If autoPublish, publish the episode.
 */
export async function importEpisode(
  zipBuffer: Buffer,
  stationId: string,
  companyId: string,
  opts?: { autoPublish?: boolean },
): Promise<ImportResult> {
  const warnings: string[] = [];

  // ── 1. Extract ZIP ──────────────────────────────────────────────────────────
  const entries = await extractZip(zipBuffer);

  // ── 2. Parse metadata.json ──────────────────────────────────────────────────
  const metadataRaw = entries.get('metadata.json');
  if (!metadataRaw) {
    throw Object.assign(new Error('Invalid .playgen file: metadata.json missing'), { code: 'INVALID_BUNDLE' });
  }
  const metadata: ExportMetadata = JSON.parse(metadataRaw.toString('utf8'));
  if (metadata.format_version !== '1.0') {
    warnings.push(`Unknown format_version "${metadata.format_version}" — continuing anyway`);
  }

  // ── 3. Parse songs.json ─────────────────────────────────────────────────────
  const songsRaw = entries.get('songs.json');
  const songEntries: ExportSongEntry[] = songsRaw
    ? JSON.parse(songsRaw.toString('utf8'))
    : [];

  // ── 4. Parse profile.json ───────────────────────────────────────────────────
  const profileRaw = entries.get('profile.json');
  const profileData: ExportProfileConfig | null = profileRaw
    ? JSON.parse(profileRaw.toString('utf8'))
    : null;

  // ── 5. Parse manifest.json ──────────────────────────────────────────────────
  const manifestRaw = entries.get('manifest.json');
  const manifestData: Record<string, unknown> | null = manifestRaw
    ? JSON.parse(manifestRaw.toString('utf8'))
    : null;

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Find or create the program ───────────────────────────────────────────
    const programId = await upsertProgram(client, stationId, companyId, metadata.program, warnings);

    // ── Create episode ───────────────────────────────────────────────────────
    const episodeId = await createEpisode(client, programId, metadata.episode, warnings);

    // ── Match songs and create/link playlist ─────────────────────────────────
    let playlistId: string | null = null;
    if (songEntries.length > 0) {
      playlistId = await importPlaylist(client, stationId, companyId, episodeId, metadata, songEntries, warnings);
    }

    // ── DJ profile ───────────────────────────────────────────────────────────
    let djProfileId: string | null = null;
    if (profileData) {
      djProfileId = await upsertDjProfile(client, companyId, profileData, warnings);
    }

    // ── Store manifest ────────────────────────────────────────────────────────
    let manifestId: string | null = null;
    if (manifestData && djProfileId) {
      manifestId = await createManifest(client, episodeId, stationId, djProfileId, manifestData, warnings);
    }

    // ── Link playlist + manifest to episode ──────────────────────────────────
    if (playlistId || manifestId) {
      await client.query(
        `UPDATE program_episodes SET
           playlist_id = COALESCE($2, playlist_id),
           manifest_id = COALESCE($3, manifest_id),
           updated_at  = NOW()
         WHERE id = $1`,
        [episodeId, playlistId, manifestId],
      );
    }

    // ── Copy DJ audio files ───────────────────────────────────────────────────
    const localStoragePath = process.env.STORAGE_LOCAL_PATH ?? '/tmp/playgen-dj';
    const audioWarnings = await copyAudioFiles(entries, localStoragePath);
    warnings.push(...audioWarnings);

    // ── Auto-publish ──────────────────────────────────────────────────────────
    if (opts?.autoPublish) {
      await client.query(
        `UPDATE program_episodes
         SET status = 'aired', published_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [episodeId],
      );
    }

    await client.query('COMMIT');
    return { episodeId, warnings };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function extractZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const directory = await unzipper.Open.buffer(buffer);
  for (const file of directory.files) {
    if (file.type === 'File') {
      const data = await file.buffer();
      result.set(file.path, data);
    }
  }
  return result;
}

async function upsertProgram(
  client: PoolClient,
  stationId: string,
  _companyId: string,
  programMeta: ExportMetadata['program'],
  warnings: string[],
): Promise<string> {
  // Try to find an existing program with the same name on this station
  const { rows } = await client.query(
    `SELECT id FROM programs WHERE station_id = $1 AND name = $2 LIMIT 1`,
    [stationId, programMeta.name],
  );
  if (rows.length) {
    warnings.push(`Program "${programMeta.name}" already exists on station — reusing it`);
    return rows[0].id as string;
  }

  const { rows: created } = await client.query(
    `INSERT INTO programs (station_id, name, description, active_days, start_hour, end_hour, color_tag)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      stationId,
      programMeta.name,
      programMeta.description ?? null,
      programMeta.active_days ?? [],
      programMeta.start_hour ?? 0,
      programMeta.end_hour ?? 24,
      programMeta.color_tag ?? null,
    ],
  );
  return created[0].id as string;
}

async function createEpisode(
  client: PoolClient,
  programId: string,
  episodeMeta: ExportMetadata['episode'],
  warnings: string[],
): Promise<string> {
  // Check for existing episode on the same date for this program
  const { rows: existing } = await client.query(
    `SELECT id FROM program_episodes WHERE program_id = $1 AND air_date = $2 LIMIT 1`,
    [programId, episodeMeta.air_date],
  );
  if (existing.length) {
    warnings.push(`Episode for ${episodeMeta.air_date} already exists on this program — overwriting notes only`);
    await client.query(
      `UPDATE program_episodes SET notes = $2, updated_at = NOW() WHERE id = $1`,
      [existing[0].id, episodeMeta.notes ?? null],
    );
    return existing[0].id as string;
  }

  const { rows } = await client.query(
    `INSERT INTO program_episodes (program_id, air_date, status, notes, episode_title)
     VALUES ($1, $2, 'draft', $3, $4)
     RETURNING id`,
    [programId, episodeMeta.air_date, episodeMeta.notes ?? null, episodeMeta.episode_title ?? null],
  );
  return rows[0].id as string;
}

async function importPlaylist(
  client: PoolClient,
  stationId: string,
  _companyId: string,
  _episodeId: string,
  metadata: ExportMetadata,
  songEntries: ExportSongEntry[],
  warnings: string[],
): Promise<string> {
  // Create a new draft playlist for the imported episode
  const airDate = metadata.episode.air_date;
  const { rows: playlistRows } = await client.query(
    `INSERT INTO playlists (station_id, date, status)
     VALUES ($1, $2, 'draft')
     RETURNING id`,
    [stationId, airDate],
  );
  const playlistId = playlistRows[0].id as string;

  // Match each song by title + artist on this station; warn on missing
  for (const entry of songEntries) {
    const { rows: songRows } = await client.query(
      `SELECT id FROM songs
       WHERE station_id = $1
         AND LOWER(title) = LOWER($2)
         AND LOWER(artist) = LOWER($3)
         AND is_active = TRUE
       LIMIT 1`,
      [stationId, entry.title, entry.artist],
    );

    if (!songRows.length) {
      warnings.push(`Song not found: "${entry.title}" by ${entry.artist} — skipped`);
      continue;
    }

    await client.query(
      `INSERT INTO playlist_entries (playlist_id, hour, position, song_id, is_manual_override)
       VALUES ($1, $2, $3, $4, FALSE)`,
      [playlistId, entry.hour, entry.position, songRows[0].id],
    );
  }

  return playlistId;
}

async function upsertDjProfile(
  client: PoolClient,
  companyId: string,
  profileData: ExportProfileConfig,
  warnings: string[],
): Promise<string> {
  // Guard: check table exists
  const { rows: tableCheck } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'dj_profiles'
     ) AS exists`,
  );
  if (!tableCheck[0]?.exists) {
    warnings.push('dj_profiles table not found — DJ profile not imported');
    return '';
  }

  // Find by name within company
  const { rows: existing } = await client.query(
    `SELECT id FROM dj_profiles WHERE company_id = $1 AND name = $2 LIMIT 1`,
    [companyId, profileData.name],
  );
  if (existing.length) {
    warnings.push(`DJ profile "${profileData.name}" already exists — reusing it`);
    return existing[0].id as string;
  }

  const { rows } = await client.query(
    `INSERT INTO dj_profiles
       (company_id, name, personality, voice_style, persona_config, llm_model,
        llm_temperature, tts_provider, tts_voice_id, is_default, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,TRUE)
     RETURNING id`,
    [
      companyId,
      profileData.name,
      profileData.personality,
      profileData.voice_style,
      JSON.stringify(profileData.persona_config),
      profileData.llm_model,
      profileData.llm_temperature,
      profileData.tts_provider,
      profileData.tts_voice_id,
    ],
  );
  return rows[0].id as string;
}

async function createManifest(
  client: PoolClient,
  episodeId: string,
  stationId: string,
  djProfileId: string,
  manifestData: Record<string, unknown>,
  warnings: string[],
): Promise<string | null> {
  // Guard: check table and episode dj_script_id
  const { rows: tableCheck } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'dj_show_manifests'
     ) AS exists`,
  );
  if (!tableCheck[0]?.exists) {
    warnings.push('dj_show_manifests table not found — manifest not imported');
    return null;
  }

  // We need a script_id to satisfy FK. Look up or create a minimal dj_script record.
  const { rows: episodeRows } = await client.query(
    `SELECT dj_script_id FROM program_episodes WHERE id = $1`,
    [episodeId],
  );
  let scriptId: string | null = episodeRows[0]?.dj_script_id ?? null;

  if (!scriptId) {
    // Create a minimal stub script so the manifest FK is satisfied
    const { rows: scriptRows } = await client.query(
      `INSERT INTO dj_scripts
         (playlist_id, station_id, dj_profile_id, review_status, llm_model, total_segments)
       VALUES (NULL, $1, $2, 'approved', 'imported', 0)
       RETURNING id`,
      [stationId, djProfileId],
    );
    scriptId = scriptRows[0].id as string;
    await client.query(
      `UPDATE program_episodes SET dj_script_id = $2, updated_at = NOW() WHERE id = $1`,
      [episodeId, scriptId],
    );
  }

  const { rows } = await client.query(
    `INSERT INTO dj_show_manifests
       (script_id, station_id, status, storage_provider, manifest_url, total_duration_sec)
     VALUES ($1, $2, 'ready', $3, $4, $5)
     RETURNING id`,
    [
      scriptId,
      stationId,
      (manifestData.storage_provider as string) ?? 'local',
      (manifestData.manifest_url as string | null) ?? null,
      (manifestData.total_duration_sec as number | null) ?? null,
    ],
  );
  return rows[0].id as string;
}

async function copyAudioFiles(entries: Map<string, Buffer>, localStoragePath: string): Promise<string[]> {
  const warnings: string[] = [];
  for (const [entryPath, data] of entries) {
    if (!entryPath.startsWith('audio/dj/')) continue;
    // Strip the 'audio/dj/' prefix — the remainder is the relative storage path
    const relPath = entryPath.slice('audio/dj/'.length);
    if (!relPath) continue;
    const fullPath = path.join(localStoragePath, relPath);
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, data);
    } catch (err) {
      warnings.push(`Failed to write audio file ${relPath}: ${(err as Error).message}`);
    }
  }
  return warnings;
}
