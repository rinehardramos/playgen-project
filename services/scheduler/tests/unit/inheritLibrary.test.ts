/**
 * Unit tests for inherit_library category remapping in generationEngine.ts
 *
 * Root cause: when inherit_library=true, sibling station songs are loaded but
 * indexed under their own station's category UUIDs. Template slots reference the
 * current station's category UUIDs, so sibling songs were never found.
 *
 * Fix: remap sibling songs' category_id to the matching own-station category
 * (by category code) when building the songsByCategory map.
 *
 * These tests verify the remapping logic as a pure function mirroring production.
 */

import { describe, it, expect } from 'vitest';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SongWithEligibility {
  id: string;
  artist: string;
  station_id: string;
  category_id: string;
  eligible_hours: number[];
}

interface CategoryRow {
  station_id: string;
  id: string;
  code: string;
}

// ─── Pure helper (mirrors generationEngine.ts Step 9a buildSongsByCategory) ──

/**
 * Builds the songsByCategory index.
 * When inheritLibrary=true and there are sibling stations, remaps sibling songs'
 * category_ids to the matching current-station category (by code).
 */
function buildSongsByCategory(
  songs: SongWithEligibility[],
  stationId: string,
  inheritLibrary: boolean,
  allCats: CategoryRow[],
): Map<string, SongWithEligibility[]> {
  const map = new Map<string, SongWithEligibility[]>();

  const siblingStationIds = new Set(songs.map((s) => s.station_id).filter((id) => id !== stationId));
  const hasInherited = inheritLibrary && siblingStationIds.size > 0;

  if (hasInherited) {
    const ownCatByCode = new Map<string, string>();
    for (const cat of allCats) {
      if (cat.station_id === stationId) ownCatByCode.set(cat.code, cat.id);
    }
    const catCodeById = new Map<string, string>(allCats.map((c) => [c.id, c.code]));

    for (const song of songs) {
      let effectiveCategoryId = song.category_id;
      if (song.station_id !== stationId) {
        const code = catCodeById.get(song.category_id);
        const ownCatId = code ? ownCatByCode.get(code) : undefined;
        if (ownCatId) effectiveCategoryId = ownCatId;
      }
      const arr = map.get(effectiveCategoryId) ?? [];
      arr.push(song);
      map.set(effectiveCategoryId, arr);
    }
  } else {
    for (const song of songs) {
      const arr = map.get(song.category_id) ?? [];
      arr.push(song);
      map.set(song.category_id, arr);
    }
  }

  return map;
}

// ─── Test data ────────────────────────────────────────────────────────────────

const OWN_STATION_ID = 'station-own';
const SIBLING_STATION_ID = 'station-sibling';

// Own station has a "POP" category (no songs yet)
const OWN_CAT_POP = 'cat-own-pop';
const OWN_CAT_ROCK = 'cat-own-rock';

// Sibling station has corresponding "POP" and "ROCK" categories
const SIBLING_CAT_POP = 'cat-sibling-pop';
const SIBLING_CAT_ROCK = 'cat-sibling-rock';

const categories: CategoryRow[] = [
  { station_id: OWN_STATION_ID, id: OWN_CAT_POP, code: 'POP' },
  { station_id: OWN_STATION_ID, id: OWN_CAT_ROCK, code: 'ROCK' },
  { station_id: SIBLING_STATION_ID, id: SIBLING_CAT_POP, code: 'POP' },
  { station_id: SIBLING_STATION_ID, id: SIBLING_CAT_ROCK, code: 'ROCK' },
];

const siblingSongs: SongWithEligibility[] = [
  { id: 'sib-1', artist: 'Artist A', station_id: SIBLING_STATION_ID, category_id: SIBLING_CAT_POP, eligible_hours: [] },
  { id: 'sib-2', artist: 'Artist B', station_id: SIBLING_STATION_ID, category_id: SIBLING_CAT_POP, eligible_hours: [8, 12] },
  { id: 'sib-3', artist: 'Artist C', station_id: SIBLING_STATION_ID, category_id: SIBLING_CAT_ROCK, eligible_hours: [] },
];

const ownSongs: SongWithEligibility[] = [
  { id: 'own-1', artist: 'Local Artist', station_id: OWN_STATION_ID, category_id: OWN_CAT_POP, eligible_hours: [] },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('inherit_library — category remapping in buildSongsByCategory', () => {
  it('without inherit_library: sibling songs remain under their own category UUIDs', () => {
    const allSongs = [...ownSongs, ...siblingSongs];
    const map = buildSongsByCategory(allSongs, OWN_STATION_ID, false, categories);

    // Own songs accessible via own category UUID
    expect(map.get(OWN_CAT_POP)).toHaveLength(1);

    // Sibling songs NOT remapped — still under sibling UUIDs
    expect(map.get(SIBLING_CAT_POP)).toHaveLength(2);
    expect(map.get(OWN_CAT_POP)?.map((s) => s.id)).not.toContain('sib-1');
  });

  it('with inherit_library: sibling songs are remapped to own station category UUID', () => {
    const allSongs = [...ownSongs, ...siblingSongs];
    const map = buildSongsByCategory(allSongs, OWN_STATION_ID, true, categories);

    // Own POP category now has own song + both sibling POP songs
    const popSongs = map.get(OWN_CAT_POP) ?? [];
    expect(popSongs).toHaveLength(3); // own-1 + sib-1 + sib-2
    expect(popSongs.map((s) => s.id)).toContain('own-1');
    expect(popSongs.map((s) => s.id)).toContain('sib-1');
    expect(popSongs.map((s) => s.id)).toContain('sib-2');

    // ROCK category now has the sibling ROCK song
    const rockSongs = map.get(OWN_CAT_ROCK) ?? [];
    expect(rockSongs).toHaveLength(1);
    expect(rockSongs[0].id).toBe('sib-3');

    // Sibling UUIDs should not be the primary keys
    expect(map.has(SIBLING_CAT_POP)).toBe(false);
    expect(map.has(SIBLING_CAT_ROCK)).toBe(false);
  });

  it('with inherit_library: station with NO own songs gets sibling songs remapped', () => {
    // Own station has 0 songs of its own
    const map = buildSongsByCategory(siblingSongs, OWN_STATION_ID, true, categories);

    const popSongs = map.get(OWN_CAT_POP) ?? [];
    expect(popSongs).toHaveLength(2);

    const rockSongs = map.get(OWN_CAT_ROCK) ?? [];
    expect(rockSongs).toHaveLength(1);
  });

  it('with inherit_library: own station songs take priority (appear first) in pool', () => {
    const allSongs = [...ownSongs, ...siblingSongs];
    const map = buildSongsByCategory(allSongs, OWN_STATION_ID, true, categories);

    // Own song is added first (it's the first in allSongs), so it appears first in the pool
    const popSongs = map.get(OWN_CAT_POP) ?? [];
    expect(popSongs[0].id).toBe('own-1');
  });

  it('with inherit_library: sibling songs with no matching own category keep their own UUID', () => {
    // Sibling has a category "JAZZ" that the own station doesn't have
    const siblingJazzCat = 'cat-sibling-jazz';
    const jazzSong: SongWithEligibility = {
      id: 'sib-jazz-1',
      artist: 'Jazz Artist',
      station_id: SIBLING_STATION_ID,
      category_id: siblingJazzCat,
      eligible_hours: [],
    };

    const catsWithJazz: CategoryRow[] = [
      ...categories,
      { station_id: SIBLING_STATION_ID, id: siblingJazzCat, code: 'JAZZ' },
    ];

    const map = buildSongsByCategory([jazzSong], OWN_STATION_ID, true, catsWithJazz);

    // No matching own category for JAZZ — song stays under its own UUID
    expect(map.get(siblingJazzCat)).toHaveLength(1);
  });
});
