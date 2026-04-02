/**
 * Seed script: imports PlayGen Encoder2.2.xlsm into a target station.
 *
 * Usage:
 *   XLSM_PATH=/path/to/PlayGen Encoder2.2.xlsm \
 *   STATION_ID=<uuid> \
 *   COMPANY_ID=<uuid> \
 *   INCLUDE_HISTORY=true \
 *   node dist/seeds/playgen.js
 *
 * Or via docker-compose:
 *   docker-compose exec library pnpm run seed:xlsm
 */

import path from 'path';
import ExcelJS from 'exceljs';
import { getPool } from '../client';
// ── Inline parser (pure functions, no Fastify deps) ──────────────────────────
// Duplicated here intentionally: seed scripts run outside the service boundary.
// If the parser logic changes, update both this file and importParser.ts in library-service.

const SONG_SHEET_NAMES = [
  'FGs','FGf','PGs','PGf','JBx','7','7B','8','8B','9','9B',
  'c1','c2','c3','y1','y1B','y2','y2B','duplex','duplexB',
  'x','pd','d1','d2','d3','d4','d9','dc','dr','xmas 24',
];

const CATEGORY_LABELS: Record<string, string> = {
  FGs:'Foreign Golden Standards (Slow)',FGf:'Foreign Golden Standards (Fast)',
  PGs:'Philippine Golden Standards (Slow)',PGf:'Philippine Golden Standards (Fast)',
  JBx:'Jeepney Beat / OPM','7':'70s Music','7B':'70s Music (B)',
  '8':'80s Music','8B':'80s Music (B)','9':'90s Music','9B':'90s Music (B)',
  c1:'Contemporary (Pool 1)',c2:'Contemporary (Pool 2)',c3:'Contemporary (Pool 3)',
  y1:'Young Contemporary (Pool 1)',y1B:'Young Contemporary (Pool 1B)',
  y2:'Young Contemporary (Pool 2)',y2B:'Young Contemporary (Pool 2B)',
  duplex:'Duplex',duplexB:'Duplex (B)',x:'Special',pd:'Promo / Dedication',
  d1:'Dedication (Pool 1)',d2:'Dedication (Pool 2)',d3:'Dedication (Pool 3)',
  d4:'Dedication (Pool 4)',d9:'Dedication (Pool 9)',dc:'Dedication (Classic)',dr:'Dedication (Request)',
};

interface ParsedSong {
  categoryCode: string; title: string; artist: string;
  eligibleHours: number[]; durationSec: number | null; rawMaterial: string;
}

function parseMaterialString(raw: string): ParsedSong | null {
  if (!raw?.trim()) return null;
  const codeMatch = raw.match(/^(\S+)\s+/);
  if (!codeMatch) return null;
  const categoryCode = codeMatch[1].trim();
  const slotTokenMatch = raw.match(/\{([^}]*)\}/);
  const eligibleHours: number[] = [];
  let rest = raw.slice(codeMatch[0].length).trim();
  if (slotTokenMatch) {
    rest = rest.replace(slotTokenMatch[0], '').trim();
    for (const token of slotTokenMatch[1].split('-').filter(Boolean)) {
      const m = token.match(/_(\d+)$/);
      if (m) { const h = parseInt(m[1],10); if (h>=0&&h<=23&&!eligibleHours.includes(h)) eligibleHours.push(h); }
    }
    eligibleHours.sort((a,b)=>a-b);
  }
  let durationSec: number | null = null;
  const dm = rest.match(/\((\d+):(\d+)(?:min)?\)/);
  if (dm) { durationSec = parseInt(dm[1],10)*60+parseInt(dm[2],10); rest = rest.replace(dm[0],'').trim(); }
  const sep = rest.lastIndexOf(' - ');
  if (sep === -1) return { categoryCode, title: rest.trim(), artist: 'Unknown', eligibleHours, durationSec, rawMaterial: raw };
  const title = rest.slice(0, sep).trim();
  const artist = rest.slice(sep+3).trim();
  if (!title || !artist) return null;
  return { categoryCode, title, artist, eligibleHours, durationSec, rawMaterial: raw };
}

function parseXlsmCategorySheet(rows: unknown[][], _sheetName?: string): ParsedSong[] {
  const songs: ParsedSong[] = [];
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[1]) continue;
    const raw = String(row[1]).trim();
    if (!raw) continue;
    const parsed = parseMaterialString(raw);
    if (parsed) songs.push(parsed);
  }
  return songs;
}
// ── End inline parser ─────────────────────────────────────────────────────────

const XLSM_PATH = process.env.XLSM_PATH ?? path.join(__dirname, '../../../../PlayGen Encoder2.2.xlsm');
const STATION_ID = process.env.STATION_ID ?? '';
const COMPANY_ID = process.env.COMPANY_ID ?? '';
const INCLUDE_HISTORY = process.env.INCLUDE_HISTORY === 'true';

async function seed() {
  if (!STATION_ID || !COMPANY_ID) {
    console.error('STATION_ID and COMPANY_ID are required.');
    process.exit(1);
  }

  const pool = getPool();
  const workbook = new ExcelJS.Workbook();

  console.log(`Reading: ${XLSM_PATH}`);
  await workbook.xlsx.readFile(XLSM_PATH);
  console.log(`Sheets found: ${workbook.worksheets.map(w => w.name).join(', ')}`);

  let totalSongs = 0;
  let totalSkipped = 0;
  let totalCategories = 0;

  for (const sheetName of SONG_SHEET_NAMES) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      console.log(`  [skip] Sheet "${sheetName}" not found`);
      continue;
    }

    const rows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => rows.push(row.values as unknown[]));

    const songs = parseXlsmCategorySheet(rows, sheetName);
    if (!songs.length) {
      console.log(`  [skip] Sheet "${sheetName}" — no songs parsed`);
      continue;
    }

    const categoryLabel = CATEGORY_LABELS[sheetName] ?? sheetName;
    const categoryCodes = [...new Set(songs.map(s => s.categoryCode))];

    // Upsert categories
    const categoryMap = new Map<string, string>();
    for (const code of categoryCodes) {
      const { rows: catRows } = await pool.query(
        `INSERT INTO categories (station_id, code, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (station_id, code) DO UPDATE SET label = EXCLUDED.label
         RETURNING id`,
        [STATION_ID, code, categoryLabel]
      );
      categoryMap.set(code, catRows[0].id);
      totalCategories++;
    }

    // Insert songs
    let sheetCreated = 0;
    let sheetSkipped = 0;

    for (const song of songs) {
      const categoryId = categoryMap.get(song.categoryCode);
      if (!categoryId) continue;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: songRows } = await client.query(
          `INSERT INTO songs (company_id, station_id, category_id, title, artist, duration_sec, raw_material)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [COMPANY_ID, STATION_ID, categoryId, song.title, song.artist, song.durationSec, song.rawMaterial]
        );

        if (songRows[0] && song.eligibleHours.length > 0) {
          await client.query(
            `INSERT INTO song_slots (song_id, eligible_hour)
             SELECT $1, UNNEST($2::smallint[])
             ON CONFLICT DO NOTHING`,
            [songRows[0].id, song.eligibleHours]
          );
          sheetCreated++;
        } else {
          sheetSkipped++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  [error] ${song.rawMaterial}:`, err);
        sheetSkipped++;
      } finally {
        client.release();
      }
    }

    console.log(`  [done] "${sheetName}" — ${sheetCreated} created, ${sheetSkipped} skipped`);
    totalSongs += sheetCreated;
    totalSkipped += sheetSkipped;
  }

  console.log(`\nSeed complete:`);
  console.log(`  Categories upserted : ${totalCategories}`);
  console.log(`  Songs created       : ${totalSongs}`);
  console.log(`  Songs skipped       : ${totalSkipped}`);

  if (INCLUDE_HISTORY) {
    console.log('\nImporting LOAD sheet history...');
    await importLoadHistory(workbook, pool);
  }

  await pool.end();
}

async function importLoadHistory(workbook: ExcelJS.Workbook, pool: ReturnType<typeof getPool>) {
  const loadSheet = workbook.getWorksheet('LOAD');
  if (!loadSheet) { console.log('  [skip] LOAD sheet not found'); return; }

  const rows: unknown[][] = [];
  loadSheet.eachRow({ includeEmpty: false }, (row) => rows.push(row.values as unknown[]));

  // Parse hour map from row 0
  const hourRow = rows[0] ?? [];
  const colToHour = new Map<number, number>();
  for (let col = 1; col < hourRow.length; col++) {
    const cell = hourRow[col];
    if (!cell) continue;
    let hour: number | null = null;
    if (cell instanceof Date) hour = cell.getHours();
    else if (typeof cell === 'string') { const m = cell.match(/(\d{1,2}):/); if (m) hour = parseInt(m[1], 10); }
    if (hour !== null) colToHour.set(col, hour);
  }

  let inserted = 0;
  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    if (!row?.[1]) continue;
    const rawMaterial = String(row[1]).trim();

    const { rows: songRows } = await pool.query(
      'SELECT id FROM songs WHERE station_id = $1 AND raw_material = $2 LIMIT 1',
      [STATION_ID, rawMaterial]
    );
    if (!songRows[0]) continue;
    const songId = songRows[0].id;

    let totalPlays = 0;
    for (let col = 2; col < row.length; col++) {
      const val = row[col];
      if (!val || val === 0) continue;
      const count = typeof val === 'number' ? val : parseInt(String(val), 10);
      if (!isNaN(count)) totalPlays += count;
    }

    for (let i = 0; i < totalPlays; i++) {
      await pool.query(
        `INSERT INTO play_history (song_id, station_id, played_at, source)
         VALUES ($1, $2, NOW() - ($3 || ' days')::interval, 'imported')
         ON CONFLICT DO NOTHING`,
        [songId, STATION_ID, totalPlays - i]
      );
      inserted++;
    }
  }
  console.log(`  Play history events inserted: ${inserted}`);
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
