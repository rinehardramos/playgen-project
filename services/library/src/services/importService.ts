import ExcelJS from 'exceljs';
import { getPool } from '../db';
import { upsertCategory } from './categoryService';
import { bulkCreateSongs } from './songService';
import {
  parseMaterialString,
  parseXlsmCategorySheet,
  parseXlsmTemplateSheet,
  parseXlsmLoadSheet,
  SONG_SHEET_NAMES,
  TEMPLATE_SHEET_MAP,
  CATEGORY_LABELS,
} from './importParser';

export interface ImportResult {
  songs_created: number;
  songs_skipped: number;
  categories_upserted: number;
  errors: string[];
}

export interface LoadImportResult {
  entries_processed: number;
  play_events_inserted: number;
  errors: string[];
}

/**
 * Import songs from a PlayGen Encoder .xlsm file.
 * Reads all category sheets and upserts categories + songs.
 */
export async function importXlsmSongs(
  filePath: string,
  stationId: string,
  companyId: string
): Promise<ImportResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const result: ImportResult = { songs_created: 0, songs_skipped: 0, categories_upserted: 0, errors: [] };

  for (const sheetName of SONG_SHEET_NAMES) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;

    // Convert worksheet to raw row arrays
    const rows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      rows.push(row.values as unknown[]);
    });

    // Determine category group from sheet name (strip trailing letters like FGsA → FGs)
    const categoryGroupKey = sheetName;
    const categoryLabel = CATEGORY_LABELS[categoryGroupKey] ?? sheetName;

    const songs = parseXlsmCategorySheet(rows, sheetName);
    if (!songs.length) continue;

    // Collect unique category codes from parsed songs
    const categoryCodes = [...new Set(songs.map(s => s.categoryCode))];
    const categoryMap = new Map<string, string>(); // code → id

    for (const code of categoryCodes) {
      const cat = await upsertCategory({ station_id: stationId, code, label: categoryLabel });
      categoryMap.set(code, cat.id);
      result.categories_upserted++;
    }

    const songsToCreate = songs.map(s => ({
      company_id: companyId,
      station_id: stationId,
      category_id: categoryMap.get(s.categoryCode) ?? '',
      title: s.title,
      artist: s.artist,
      duration_sec: s.durationSec ?? undefined,
      eligible_hours: s.eligibleHours,
      raw_material: s.rawMaterial,
    })).filter(s => s.category_id);

    const { created, skipped } = await bulkCreateSongs(songsToCreate);
    result.songs_created += created;
    result.songs_skipped += skipped;
  }

  return result;
}

/**
 * Import historical play data from the LOAD sheet.
 * Converts cumulative play counts to individual play_history events.
 * Each count unit = one estimated play event, spaced one day apart.
 *
 * See LESSONS.md L-003 for rationale.
 */
export async function importXlsmLoadHistory(
  filePath: string,
  stationId: string
): Promise<LoadImportResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const loadSheet = workbook.getWorksheet('LOAD');
  if (!loadSheet) {
    return { entries_processed: 0, play_events_inserted: 0, errors: ['LOAD sheet not found'] };
  }

  const rows: unknown[][] = [];
  loadSheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push(row.values as unknown[]);
  });

  const entries = parseXlsmLoadSheet(rows);
  const pool = getPool();
  const result: LoadImportResult = { entries_processed: entries.length, play_events_inserted: 0, errors: [] };

  for (const entry of entries) {
    const parsed = parseMaterialString(entry.rawMaterial);
    if (!parsed) continue;

    // Find matching song in DB
    const { rows: songRows } = await pool.query(
      `SELECT s.id FROM songs s
       WHERE s.station_id = $1 AND s.raw_material = $2
       LIMIT 1`,
      [stationId, entry.rawMaterial]
    );

    if (!songRows[0]) continue;
    const songId = songRows[0].id;

    // Insert one play_history record per count unit, spread back in time
    const totalPlays = entry.playCounts.reduce((sum, p) => sum + p.count, 0);
    for (let i = 0; i < totalPlays; i++) {
      // Back-calculate: most recent play = today - i days
      const daysAgo = totalPlays - i;
      await pool.query(
        `INSERT INTO play_history (song_id, station_id, played_at, source)
         VALUES ($1, $2, NOW() - ($3 || ' days')::interval, 'imported')
         ON CONFLICT DO NOTHING`,
        [songId, stationId, daysAgo]
      );
      result.play_events_inserted++;
    }
  }

  return result;
}
