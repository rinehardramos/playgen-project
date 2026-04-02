import { describe, it, expect } from 'vitest';
import { parseXlsmTemplateSheet, parseXlsmCategorySheet } from '../../src/services/importParser';

// ─── Template parsing (LESSONS.md L-004) ─────────────────────────────────────

describe('parseXlsmTemplateSheet — 1_day type', () => {
  it('extracts slots from first_data_col = 4', () => {
    // Simulated rows:
    // Row 0: [null, null, null, null, Date(04:00), null, null, null, Date(05:00), ...]
    // Row 1: [null, null, null, null, 1, 2, 3, 4, 1, 2, ...]
    // Row 2: [1, 'MATERIAL', null, '`', 'FGs', 0, 0, 0, 'PGs', 0, ...]
    const hour4 = new Date(0);
    hour4.setHours(4, 0, 0, 0);
    const hour5 = new Date(0);
    hour5.setHours(5, 0, 0, 0);

    const rows = [
      [null, null, null, null, hour4, null, null, null, hour5, null, null, null],
      [null, null, null, null, 1, 2, 3, 4, 1, 2, 3, 4],
      [1, 'MATERIAL', null, '`', 'FGs', 0, 0, 0, 'PGs', 0, 0, 0],
    ];

    const result = parseXlsmTemplateSheet(rows, '1_day');
    expect(result.type).toBe('1_day');
    expect(result.slots).toContainEqual({ hour: 4, position: 1, categoryCode: 'FGs' });
    expect(result.slots).toContainEqual({ hour: 5, position: 1, categoryCode: 'PGs' });
  });

  it('computes position correctly (1-4 within each hour group)', () => {
    const hour4 = new Date(0);
    hour4.setHours(4, 0, 0, 0);

    const rows = [
      [null, null, null, null, hour4, null, null, null],
      [null, null, null, null, 1, 2, 3, 4],
      [1, 'MATERIAL', null, '`', 'FGs', 'PGs', '7', '8'],
    ];

    const result = parseXlsmTemplateSheet(rows, '1_day');
    expect(result.slots).toContainEqual({ hour: 4, position: 1, categoryCode: 'FGs' });
    expect(result.slots).toContainEqual({ hour: 4, position: 2, categoryCode: 'PGs' });
    expect(result.slots).toContainEqual({ hour: 4, position: 3, categoryCode: '7' });
    expect(result.slots).toContainEqual({ hour: 4, position: 4, categoryCode: '8' });
  });

  it('skips cells with value 0', () => {
    const hour4 = new Date(0);
    hour4.setHours(4, 0, 0, 0);

    const rows = [
      [null, null, null, null, hour4, null, null, null],
      [null, null, null, null, 1, 2, 3, 4],
      [1, 'MATERIAL', null, '`', 'FGs', 0, 0, 0],
    ];

    const result = parseXlsmTemplateSheet(rows, '1_day');
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].position).toBe(1);
  });
});

describe('parseXlsmTemplateSheet — 3_hour type', () => {
  it('uses first_data_col = 2 for 3hr templates', () => {
    const hour4 = new Date(0);
    hour4.setHours(4, 0, 0, 0);

    const rows = [
      [null, null, hour4, null, null, null],
      [null, null, 1, 2, 3, 4],
      [1, 'MATERIAL', 'FGs', 'PGs', 0, 0],
    ];

    const result = parseXlsmTemplateSheet(rows, '3_hour');
    expect(result.slots).toContainEqual({ hour: 4, position: 1, categoryCode: 'FGs' });
    expect(result.slots).toContainEqual({ hour: 4, position: 2, categoryCode: 'PGs' });
    expect(result.slots).toHaveLength(2);
  });
});

describe('parseXlsmTemplateSheet — empty sheet', () => {
  it('returns empty slots for empty rows', () => {
    const result = parseXlsmTemplateSheet([], '1_day');
    expect(result.slots).toHaveLength(0);
  });
});

// ─── Category sheet parsing ───────────────────────────────────────────────────

describe('parseXlsmCategorySheet', () => {
  it('skips header rows (0 and 1) and parses from row 2', () => {
    const rows = [
      ['#', 'MATERIAL', null, '`', '04:00:00'],   // row 0 header
      [null, null, 1, 2, 3, 4],                     // row 1 sub-positions
      [1, 'FGsA     A Man Without Love - Engelbert Humperdinck {FGsA_4-}', 0],
      [2, 'FGsA     Rain - Donna Cruz {FGsA_4-FGsA_5-}', 0],
    ];
    const songs = parseXlsmCategorySheet(rows, 'FGs');
    expect(songs).toHaveLength(2);
    expect(songs[0].title).toBe('A Man Without Love');
    expect(songs[1].title).toBe('Rain');
  });

  it('skips blank rows', () => {
    const rows = [
      ['#', 'MATERIAL'],
      [null, null],
      [1, 'FGsA     Song One - Artist One {FGsA_4-}'],
      [null, null],
      [null, ''],
      [2, 'FGsA     Song Two - Artist Two {FGsA_5-}'],
    ];
    const songs = parseXlsmCategorySheet(rows, 'FGs');
    expect(songs).toHaveLength(2);
  });

  it('skips rows where col 1 is not a valid material string', () => {
    const rows = [
      ['#', 'MATERIAL'],
      [null, null],
      [1, 'FGsA     Valid Song - Artist {FGsA_4-}'],
      [2, 0],        // numeric cell — invalid
      [3, null],     // null cell — invalid
    ];
    const songs = parseXlsmCategorySheet(rows, 'FGs');
    expect(songs).toHaveLength(1);
  });
});
