/**
 * XLSM Import Parser for PlayGen Encoder format.
 *
 * Reverse-engineered from PlayGen Encoder2.2.xlsm (see LESSONS.md L-001, L-002, L-004, L-005).
 *
 * Key format: `FGsA     Song Title - Artist Name {FGsA_4-FGsA_5-FGsA_6-}`
 *             `A7       A Love Song - Kenny Rogers {A7_4-A7_9-A7_10-}`
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedSong {
  categoryCode: string;
  title: string;
  artist: string;
  eligibleHours: number[];
  durationSec: number | null;
  rawMaterial: string;
}

export interface ParsedTemplate {
  type: '1_day' | '3_hour' | '4_hour';
  slots: Array<{ hour: number; position: number; categoryCode: string }>;
}

export interface ParsedLoadEntry {
  rawMaterial: string;
  playCounts: Array<{ hour: number; count: number }>;
}

// ─── Category sheet names → human labels (see LESSONS.md L-005) ──────────────

export const CATEGORY_LABELS: Record<string, string> = {
  FGs: 'Foreign Golden Standards (Slow)',
  FGf: 'Foreign Golden Standards (Fast)',
  PGs: 'Philippine Golden Standards (Slow)',
  PGf: 'Philippine Golden Standards (Fast)',
  JBx: 'Jeepney Beat / OPM',
  '7':  '70s Music',
  '7B': '70s Music (B)',
  '8':  '80s Music',
  '8B': '80s Music (B)',
  '9':  '90s Music',
  '9B': '90s Music (B)',
  c1:   'Contemporary (Pool 1)',
  c2:   'Contemporary (Pool 2)',
  c3:   'Contemporary (Pool 3)',
  y1:   'Young Contemporary (Pool 1)',
  y1B:  'Young Contemporary (Pool 1B)',
  y2:   'Young Contemporary (Pool 2)',
  y2B:  'Young Contemporary (Pool 2B)',
  duplex:  'Duplex',
  duplexB: 'Duplex (B)',
  x:    'Special',
  pd:   'Promo / Dedication',
  d1:   'Dedication (Pool 1)',
  d2:   'Dedication (Pool 2)',
  d3:   'Dedication (Pool 3)',
  d4:   'Dedication (Pool 4)',
  d9:   'Dedication (Pool 9)',
  dc:   'Dedication (Classic)',
  dr:   'Dedication (Request)',
};

// ─── parseMaterialString ──────────────────────────────────────────────────────

/**
 * Parses a PlayGen material string into structured data.
 *
 * Format variations handled:
 *   `FGsA     A Man Without Love - Engelbert Humperdinck {FGsA_4-FGsA_5-FGsA_6-}`
 *   `A7       A Love Song - Kenny Rogers {A7_4-A7_9-A7_10-A7_13-A7_14-}`
 *   `JBxA     Bakit Ako Mahihiya - Didith Reyes {JBxA_9-JBxA_10-}`
 *   `FGsA     Changing Partners - Patti Page (2:54min) {FGsA_4-FGsA_5-}`
 *   `FGsA     Are You Lonesome Tonight - Elvis Presley`   (no slot tokens)
 *
 * Edge cases (see LESSONS.md L-002):
 *   - Artists with hyphens: "Peter & Gordon", "Dave Clark Five"
 *   - Duration annotations: "(2:54min)" stripped before title/artist split
 *   - Multi-subtype tokens: {FGsA_4-FGsB_5-} → hours [4, 5] regardless of subtype
 *   - Songs with no {} token → eligible_hours = [] (scheduler treats as eligible for all hours)
 */
export function parseMaterialString(raw: string): ParsedSong | null {
  if (!raw?.trim()) return null;

  // Step 1: Extract category code (leading word before whitespace)
  const codeMatch = raw.match(/^(\S+)\s+/);
  if (!codeMatch) return null;
  const categoryCode = codeMatch[1].trim();

  // Step 2: Extract slot token block {CODE_hour-CODE_hour-}
  const slotTokenMatch = raw.match(/\{([^}]*)\}/);
  const eligibleHours: number[] = [];
  let rest = raw.slice(codeMatch[0].length).trim();

  if (slotTokenMatch) {
    // Remove the slot block from the rest string
    rest = rest.replace(slotTokenMatch[0], '').trim();
    // Parse each CODE_hour token — e.g. "FGsA_4", "A7_10"
    const tokenParts = slotTokenMatch[1].split('-').filter(Boolean);
    for (const token of tokenParts) {
      const hourMatch = token.match(/_(\d+)$/);
      if (hourMatch) {
        const hour = parseInt(hourMatch[1], 10);
        if (hour >= 0 && hour <= 23 && !eligibleHours.includes(hour)) {
          eligibleHours.push(hour);
        }
      }
    }
    eligibleHours.sort((a, b) => a - b);
  }

  // Step 3: Extract duration annotation e.g. "(2:54min)" or "(3:20)"
  let durationSec: number | null = null;
  const durationMatch = rest.match(/\((\d+):(\d+)(?:min)?\)/);
  if (durationMatch) {
    durationSec = parseInt(durationMatch[1], 10) * 60 + parseInt(durationMatch[2], 10);
    rest = rest.replace(durationMatch[0], '').trim();
  }

  // Step 4: Split remaining "Title - Artist" on last occurrence of " - "
  // Use last occurrence to handle artists with hyphens in their name
  const separatorIdx = rest.lastIndexOf(' - ');
  if (separatorIdx === -1) {
    // No artist separator — treat whole string as title, artist unknown
    return {
      categoryCode,
      title: rest.trim(),
      artist: 'Unknown',
      eligibleHours,
      durationSec,
      rawMaterial: raw,
    };
  }

  const title = rest.slice(0, separatorIdx).trim();
  const artist = rest.slice(separatorIdx + 3).trim();

  if (!title || !artist) return null;

  return { categoryCode, title, artist, eligibleHours, durationSec, rawMaterial: raw };
}

// ─── parseXlsmCategorySheet ───────────────────────────────────────────────────

/**
 * Parses a category sheet from PlayGen Encoder.
 * Column B (index 1) contains material strings, starting at row index 2 (after two header rows).
 * See LESSONS.md L-004 for column layout details.
 */
export function parseXlsmCategorySheet(
  rows: unknown[][],
  _sheetName: string
): ParsedSong[] {
  const songs: ParsedSong[] = [];
  // Row 0: header (# / MATERIAL / backtick / hourly slots)
  // Row 1: sub-position labels (1, 2, 3, 4 repeating)
  // Row 2+: song data
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

// ─── parseXlsmTemplateSheet ───────────────────────────────────────────────────

/**
 * Parses a template sheet from PlayGen Encoder.
 *
 * Layout (see LESSONS.md L-004):
 * - Row 0: hour labels (time values), grouped every 4 columns
 * - Row 1: sub-position labels (1, 2, 3, 4) repeating
 * - Row 2+: category code assignments (or 0 for empty)
 *
 * first_data_col:
 *   - '1_day' template: col 4 (columns 0=#, 1=MATERIAL, 2=?, 3=backtick)
 *   - '3_hour' / '4_hour' templates: col 2 (columns 0=#, 1=MATERIAL)
 */
export function parseXlsmTemplateSheet(
  rows: unknown[][],
  type: '1_day' | '3_hour' | '4_hour'
): ParsedTemplate {
  const firstDataCol = type === '1_day' ? 4 : 2;
  const slots: ParsedTemplate['slots'] = [];

  if (!rows[0]) return { type, slots };

  // Row 0 contains hour labels in groups of 4 columns
  const hourRow = rows[0];
  const hourMap = new Map<number, number>(); // colIndex → hour

  for (let col = firstDataCol; col < hourRow.length; col++) {
    const cell = hourRow[col];
    if (cell == null) continue;
    // Cell is either a Date/time object or a string like "04:00:00"
    let hour: number | null = null;
    if (cell instanceof Date) {
      hour = cell.getHours();
    } else if (typeof cell === 'string') {
      const m = cell.match(/(\d{1,2}):(\d{2})/);
      if (m) hour = parseInt(m[1], 10);
    } else if (typeof cell === 'number') {
      // Excel serial time: fractional day — convert to hours
      hour = Math.round(cell * 24) % 24;
    }
    if (hour !== null) {
      // Assign this hour to the group of 4 columns starting at col
      for (let p = 0; p < 4; p++) hourMap.set(col + p, hour);
      col += 3; // skip the 3 sub-position columns
    }
  }

  // Row 1: sub-position labels (1, 2, 3, 4)
  // Row 2+: category assignments
  for (let rowIdx = 2; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    if (!row) continue;
    for (let col = firstDataCol; col < row.length; col++) {
      const cell = row[col];
      if (cell == null || cell === 0 || cell === '0') continue;
      const categoryCode = String(cell).trim();
      if (!categoryCode || categoryCode === '0') continue;

      const hour = hourMap.get(col);
      if (hour === undefined) continue;

      const position = ((col - firstDataCol) % 4) + 1;
      // Avoid duplicate slots
      const exists = slots.some(s => s.hour === hour && s.position === position);
      if (!exists) {
        slots.push({ hour, position, categoryCode });
      }
    }
  }

  return { type, slots };
}

// ─── parseXlsmLoadSheet ───────────────────────────────────────────────────────

/**
 * Parses the LOAD sheet to extract play count history.
 *
 * Shape: 3052 rows × 397 columns.
 * Row 0: time slot headers — col 0 = 'MON-FRI', col 1+ = hour values.
 * Row 1+: song rows where col 1 contains material string (same format as category sheets),
 *         and remaining columns contain cumulative play counts.
 *
 * See LESSONS.md L-003 for the trade-off: we convert the matrix to flat play events.
 */
export function parseXlsmLoadSheet(rows: unknown[][]): ParsedLoadEntry[] {
  if (!rows[0]) return [];

  // Build hour map from row 0
  const hourRow = rows[0];
  const colToHour = new Map<number, number>();
  for (let col = 1; col < hourRow.length; col++) {
    const cell = hourRow[col];
    if (cell == null) continue;
    let hour: number | null = null;
    if (cell instanceof Date) hour = cell.getHours();
    else if (typeof cell === 'string') {
      const m = cell.match(/(\d{1,2}):(\d{2})/);
      if (m) hour = parseInt(m[1], 10);
    }
    if (hour !== null) colToHour.set(col, hour);
  }

  const entries: ParsedLoadEntry[] = [];
  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    if (!row || !row[1]) continue;
    const rawMaterial = String(row[1]).trim();
    if (!rawMaterial) continue;

    const playCounts: Array<{ hour: number; count: number }> = [];
    for (let col = 2; col < row.length; col++) {
      const val = row[col];
      if (!val || val === 0) continue;
      const count = typeof val === 'number' ? val : parseInt(String(val), 10);
      if (isNaN(count) || count <= 0) continue;
      const hour = colToHour.get(col);
      if (hour !== undefined) playCounts.push({ hour, count });
    }

    if (playCounts.length > 0) {
      entries.push({ rawMaterial, playCounts });
    }
  }
  return entries;
}

// ─── Category sheet names to parse ───────────────────────────────────────────

export const SONG_SHEET_NAMES = [
  'FGs', 'FGf', 'PGs', 'PGf', 'JBx',
  '7', '7B', '8', '8B', '9', '9B',
  'c1', 'c2', 'c3',
  'y1', 'y1B', 'y2', 'y2B',
  'duplex', 'duplexB',
  'x', 'pd',
  'd1', 'd2', 'd3', 'd4', 'd9', 'dc', 'dr',
  'xmas 24',
];

export const TEMPLATE_SHEET_MAP: Record<string, '1_day' | '3_hour' | '4_hour'> = {
  '1 day template': '1_day',
  '3 hr template': '3_hour',
  '4 hour template': '4_hour',
};
