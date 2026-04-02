import { describe, it, expect } from 'vitest';
import { parseMaterialString } from '../../src/services/importParser';

// ─── Happy path ────────────────────────────────────────────────────────────

describe('parseMaterialString — standard format', () => {
  it('parses a standard FGs entry', () => {
    const result = parseMaterialString(
      'FGsA     A Man Without Love - Engelbert Humperdinck {FGsA_4-FGsA_5-FGsA_6-}'
    );
    expect(result).not.toBeNull();
    expect(result!.categoryCode).toBe('FGsA');
    expect(result!.title).toBe('A Man Without Love');
    expect(result!.artist).toBe('Engelbert Humperdinck');
    expect(result!.eligibleHours).toEqual([4, 5, 6]);
    expect(result!.durationSec).toBeNull();
  });

  it('parses a 70s (A7) entry with multiple eligible hours', () => {
    const result = parseMaterialString(
      'A7       A Love Song - Kenny Rogers {A7_4-A7_9-A7_10-A7_13-A7_14-}'
    );
    expect(result!.categoryCode).toBe('A7');
    expect(result!.title).toBe('A Love Song');
    expect(result!.artist).toBe('Kenny Rogers');
    expect(result!.eligibleHours).toEqual([4, 9, 10, 13, 14]);
  });

  it('parses a JBx entry with late-night only hours', () => {
    const result = parseMaterialString(
      'JBxA     Bakit Ako Mahihiya - Didith Reyes {JBxA_9-JBxA_10-}'
    );
    expect(result!.eligibleHours).toEqual([9, 10]);
    expect(result!.artist).toBe('Didith Reyes');
  });

  it('parses a FGf (fast) entry', () => {
    const result = parseMaterialString(
      "FGfA     A Hard Day's Night - Beatles {FGfA_4-FGfA_5-FGfA_6-}"
    );
    expect(result!.title).toBe("A Hard Day's Night");
    expect(result!.artist).toBe('Beatles');
    expect(result!.categoryCode).toBe('FGfA');
  });
});

// ─── Duration annotations (LESSONS.md L-002) ─────────────────────────────────

describe('parseMaterialString — duration annotation', () => {
  it('extracts duration from "(2:54min)" format', () => {
    const result = parseMaterialString(
      'FGsA     Changing Partners - Patti Page (2:54min) {FGsA_4-FGsA_5-}'
    );
    expect(result!.title).toBe('Changing Partners');
    expect(result!.artist).toBe('Patti Page');
    expect(result!.durationSec).toBe(174); // 2*60 + 54
    expect(result!.eligibleHours).toEqual([4, 5]);
  });

  it('extracts duration from "(3:20)" format without "min"', () => {
    const result = parseMaterialString(
      'A7       Some Song - Some Artist (3:20) {A7_4-}'
    );
    expect(result!.durationSec).toBe(200); // 3*60 + 20
    expect(result!.title).toBe('Some Song');
  });

  it('title does not include the duration annotation', () => {
    const result = parseMaterialString(
      'FGsA     My Song (4:00min) - The Artist {FGsA_4-}'
    );
    expect(result!.title).not.toContain('(4:00min)');
  });
});

// ─── Artists with hyphens (LESSONS.md L-002) ──────────────────────────────────

describe('parseMaterialString — hyphenated artist names', () => {
  it('handles "Peter & Gordon" (ampersand, no hyphen)', () => {
    const result = parseMaterialString(
      'FGsA     A World Without Love - Peter & Gordon {FGsA_4-FGsA_5-}'
    );
    expect(result!.title).toBe('A World Without Love');
    expect(result!.artist).toBe('Peter & Gordon');
  });

  it('uses last hyphen separator to handle artist with hyphen in name', () => {
    // "Gary Lewis & The Playboys" — no internal hyphens, safe
    const result = parseMaterialString(
      'FGfA     A Night Has A Thousand Eyes - Gary Lewis & The Playboys {FGfA_4-}'
    );
    expect(result!.artist).toBe('Gary Lewis & The Playboys');
  });

  it('handles "Everly Brothers" correctly', () => {
    const result = parseMaterialString(
      'FGsA     All I Have To Do Is Dream - Everly Brothers {FGsA_4-FGsA_5-}'
    );
    expect(result!.title).toBe('All I Have To Do Is Dream');
    expect(result!.artist).toBe('Everly Brothers');
  });

  it('splits on LAST " - " so hyphenated song titles work', () => {
    // Title: "Day-O (The Banana Boat Song)" — no hyphen separator in title
    // This tests lastIndexOf behavior
    const result = parseMaterialString(
      'FGsA     Day-O (The Banana Boat Song) - Harry Belafonte {FGsA_4-}'
    );
    expect(result!.title).toBe('Day-O (The Banana Boat Song)');
    expect(result!.artist).toBe('Harry Belafonte');
  });
});

// ─── Multi-subtype tokens (LESSONS.md L-002) ──────────────────────────────────

describe('parseMaterialString — multi-subtype slot tokens', () => {
  it('extracts hours from mixed subtype tokens {FGsA_4-FGsB_5-}', () => {
    const result = parseMaterialString(
      'FGsA     Because - Dave Clark Five {FGsB_4-FGsB_5-FGsA_6-}'
    );
    expect(result!.eligibleHours).toEqual([4, 5, 6]);
  });

  it('deduplicates repeated hours in tokens', () => {
    const result = parseMaterialString(
      'A7       Test Song - Test Artist {A7_4-A7_4-A7_5-}'
    );
    expect(result!.eligibleHours).toEqual([4, 5]);
  });

  it('sorts eligible hours ascending', () => {
    const result = parseMaterialString(
      'A7       Test Song - Test Artist {A7_10-A7_4-A7_7-}'
    );
    expect(result!.eligibleHours).toEqual([4, 7, 10]);
  });
});

// ─── No slot tokens ───────────────────────────────────────────────────────────

describe('parseMaterialString — no slot token', () => {
  it('returns empty eligibleHours when no {} block present', () => {
    const result = parseMaterialString(
      'FGsA     Are You Lonesome Tonight - Elvis Presley'
    );
    expect(result!.title).toBe('Are You Lonesome Tonight');
    expect(result!.artist).toBe('Elvis Presley');
    expect(result!.eligibleHours).toEqual([]);
  });
});

// ─── Edge cases and invalid input ─────────────────────────────────────────────

describe('parseMaterialString — edge cases', () => {
  it('returns null for empty string', () => {
    expect(parseMaterialString('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseMaterialString('   ')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseMaterialString(null as unknown as string)).toBeNull();
  });

  it('stores original raw_material string', () => {
    const raw = 'FGsA     A Man Without Love - Engelbert Humperdinck {FGsA_4-}';
    const result = parseMaterialString(raw);
    expect(result!.rawMaterial).toBe(raw);
  });

  it('handles missing artist separator — treats whole string as title', () => {
    const result = parseMaterialString('FGsA     SomeSongWithNoArtist {FGsA_4-}');
    expect(result!.title).toBe('SomeSongWithNoArtist');
    expect(result!.artist).toBe('Unknown');
  });

  it('ignores hours outside 0-23 range', () => {
    const result = parseMaterialString(
      'FGsA     Test - Artist {FGsA_4-FGsA_25-FGsA_5-}'
    );
    expect(result!.eligibleHours).toEqual([4, 5]);
    expect(result!.eligibleHours).not.toContain(25);
  });
});

// ─── PGs entries (Philippine Golden Standards) ───────────────────────────────

describe('parseMaterialString — Philippine songs', () => {
  it('parses Victor Wood entry', () => {
    const result = parseMaterialString(
      'PGsA     A Tear Fell - Victor Wood {PGsA_4-PGsA_5-PGsA_6-}'
    );
    expect(result!.categoryCode).toBe('PGsA');
    expect(result!.title).toBe('A Tear Fell');
    expect(result!.artist).toBe('Victor Wood');
  });

  it('parses Nora Aunor entry', () => {
    const result = parseMaterialString(
      'PGsA     Dio Como Ti Amo - Nora Aunor {PGsA_4-PGsA_5-}'
    );
    expect(result!.artist).toBe('Nora Aunor');
  });
});
