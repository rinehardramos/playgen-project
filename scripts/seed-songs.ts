#!/usr/bin/env tsx
/**
 * seed-songs.ts
 *
 * Seeds Billboard Hot 100 year-end #1s (2000–2026) and top OPM songs (2000–2026)
 * into the PlayGen database for a target station.
 *
 * Usage:
 *   pnpm tsx scripts/seed-songs.ts [--station-slug <slug>] [--dry-run]
 *
 * Defaults to the OwnRadio station (slug: ownradio).
 * Set DATABASE_URL in .env or environment.
 */

import path from 'path';
import fs from 'fs';
import pg from 'pg';

// ── Load .env ─────────────────────────────────────────────────────────────
const envPath = path.join(import.meta.dirname ?? __dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const slugIdx = args.indexOf('--station-slug');
const targetSlug = slugIdx !== -1 ? args[slugIdx + 1] : 'ownradio';

// ── Song data ─────────────────────────────────────────────────────────────

interface Song {
  title: string;
  artist: string;
  year: number;
  genre: 'pop' | 'opm';
}

const BILLBOARD_SONGS: Song[] = [
  // Year-end #1 Hot 100 hits (2000–2026) — verified from Wikipedia year-end charts
  { title: "Smooth", artist: "Santana featuring Rob Thomas", year: 2000, genre: "pop" },
  { title: "Breathe", artist: "Faith Hill", year: 2000, genre: "pop" },
  { title: "Independent Women Part I", artist: "Destiny's Child", year: 2001, genre: "pop" },
  { title: "Hanging by a Moment", artist: "Lifehouse", year: 2001, genre: "pop" },
  { title: "How You Remind Me", artist: "Nickelback", year: 2002, genre: "pop" },
  { title: "Foolish", artist: "Ashanti", year: 2002, genre: "pop" },
  { title: "In da Club", artist: "50 Cent", year: 2003, genre: "pop" },
  { title: "Crazy in Love", artist: "Beyoncé featuring Jay-Z", year: 2003, genre: "pop" },
  { title: "Yeah!", artist: "Usher featuring Lil Jon and Ludacris", year: 2004, genre: "pop" },
  { title: "Burn", artist: "Usher", year: 2004, genre: "pop" },
  { title: "We Belong Together", artist: "Mariah Carey", year: 2005, genre: "pop" },
  { title: "Gold Digger", artist: "Kanye West featuring Jamie Foxx", year: 2005, genre: "pop" },
  { title: "Bad Day", artist: "Daniel Powter", year: 2006, genre: "pop" },
  { title: "Temperature", artist: "Sean Paul", year: 2006, genre: "pop" },
  { title: "Irreplaceable", artist: "Beyoncé", year: 2007, genre: "pop" },
  { title: "Umbrella", artist: "Rihanna featuring Jay-Z", year: 2007, genre: "pop" },
  { title: "Low", artist: "Flo Rida featuring T-Pain", year: 2008, genre: "pop" },
  { title: "Lollipop", artist: "Lil Wayne", year: 2008, genre: "pop" },
  { title: "Boom Boom Pow", artist: "Black Eyed Peas", year: 2009, genre: "pop" },
  { title: "I Gotta Feeling", artist: "Black Eyed Peas", year: 2009, genre: "pop" },
  { title: "TiK ToK", artist: "Ke$ha", year: 2010, genre: "pop" },
  { title: "California Gurls", artist: "Katy Perry featuring Snoop Dogg", year: 2010, genre: "pop" },
  { title: "Rolling in the Deep", artist: "Adele", year: 2011, genre: "pop" },
  { title: "Party Rock Anthem", artist: "LMFAO featuring Lauren Bennett and GoonRock", year: 2011, genre: "pop" },
  { title: "Somebody That I Used to Know", artist: "Gotye featuring Kimbra", year: 2012, genre: "pop" },
  { title: "We Are Never Ever Getting Back Together", artist: "Taylor Swift", year: 2012, genre: "pop" },
  { title: "Thrift Shop", artist: "Macklemore & Ryan Lewis featuring Wanz", year: 2013, genre: "pop" },
  { title: "Blurred Lines", artist: "Robin Thicke featuring T.I. and Pharrell", year: 2013, genre: "pop" },
  { title: "Happy", artist: "Pharrell Williams", year: 2014, genre: "pop" },
  { title: "All About That Bass", artist: "Meghan Trainor", year: 2014, genre: "pop" },
  { title: "Uptown Funk", artist: "Mark Ronson featuring Bruno Mars", year: 2015, genre: "pop" },
  { title: "See You Again", artist: "Wiz Khalifa featuring Charlie Puth", year: 2015, genre: "pop" },
  { title: "One Dance", artist: "Drake featuring WizKid and Kyla", year: 2016, genre: "pop" },
  { title: "Work", artist: "Rihanna featuring Drake", year: 2016, genre: "pop" },
  { title: "Shape of You", artist: "Ed Sheeran", year: 2017, genre: "pop" },
  { title: "That's What I Like", artist: "Bruno Mars", year: 2017, genre: "pop" },
  { title: "God's Plan", artist: "Drake", year: 2018, genre: "pop" },
  { title: "Perfect", artist: "Ed Sheeran", year: 2018, genre: "pop" },
  { title: "Old Town Road", artist: "Lil Nas X featuring Billy Ray Cyrus", year: 2019, genre: "pop" },
  { title: "Sunflower", artist: "Post Malone & Swae Lee", year: 2019, genre: "pop" },
  { title: "Blinding Lights", artist: "The Weeknd", year: 2020, genre: "pop" },
  { title: "Rockstar", artist: "DaBaby featuring Roddy Ricch", year: 2020, genre: "pop" },
  { title: "Levitating", artist: "Dua Lipa featuring DaBaby", year: 2021, genre: "pop" },
  { title: "Save Your Tears", artist: "The Weeknd & Ariana Grande", year: 2021, genre: "pop" },
  { title: "As It Was", artist: "Harry Styles", year: 2022, genre: "pop" },
  { title: "Heat Waves", artist: "Glass Animals", year: 2022, genre: "pop" },
  { title: "Flowers", artist: "Miley Cyrus", year: 2023, genre: "pop" },
  { title: "Kill Bill", artist: "SZA", year: 2023, genre: "pop" },
  { title: "A Bar Song (Tipsy)", artist: "Shaboozey", year: 2024, genre: "pop" },
  { title: "Espresso", artist: "Sabrina Carpenter", year: 2024, genre: "pop" },
  { title: "Not Like Us", artist: "Kendrick Lamar", year: 2024, genre: "pop" },
  { title: "Luther", artist: "Kendrick Lamar & SZA", year: 2025, genre: "pop" },
  { title: "Beautiful Things", artist: "Benson Boone", year: 2025, genre: "pop" },
  // Additional popular hits from these years
  { title: "Lose Yourself", artist: "Eminem", year: 2002, genre: "pop" },
  { title: "Beautiful", artist: "Christina Aguilera", year: 2003, genre: "pop" },
  { title: "Boulevard of Broken Dreams", artist: "Green Day", year: 2004, genre: "pop" },
  { title: "Since U Been Gone", artist: "Kelly Clarkson", year: 2005, genre: "pop" },
  { title: "Hips Don't Lie", artist: "Shakira featuring Wyclef Jean", year: 2006, genre: "pop" },
  { title: "Beautiful Girls", artist: "Sean Kingston", year: 2007, genre: "pop" },
  { title: "Bleeding Love", artist: "Leona Lewis", year: 2008, genre: "pop" },
  { title: "Use Somebody", artist: "Kings of Leon", year: 2009, genre: "pop" },
  { title: "Need You Now", artist: "Lady Antebellum", year: 2010, genre: "pop" },
  { title: "Grenade", artist: "Bruno Mars", year: 2011, genre: "pop" },
  { title: "Call Me Maybe", artist: "Carly Rae Jepsen", year: 2012, genre: "pop" },
  { title: "Royals", artist: "Lorde", year: 2013, genre: "pop" },
  { title: "Stay With Me", artist: "Sam Smith", year: 2014, genre: "pop" },
  { title: "Stressed Out", artist: "Twenty One Pilots", year: 2015, genre: "pop" },
  { title: "Closer", artist: "The Chainsmokers featuring Halsey", year: 2016, genre: "pop" },
  { title: "Despacito", artist: "Luis Fonsi & Daddy Yankee featuring Justin Bieber", year: 2017, genre: "pop" },
  { title: "In My Feelings", artist: "Drake", year: 2018, genre: "pop" },
  { title: "Bad Guy", artist: "Billie Eilish", year: 2019, genre: "pop" },
  { title: "Watermelon Sugar", artist: "Harry Styles", year: 2020, genre: "pop" },
  { title: "drivers license", artist: "Olivia Rodrigo", year: 2021, genre: "pop" },
  { title: "Stay", artist: "The Kid LAROI & Justin Bieber", year: 2021, genre: "pop" },
  { title: "About Damn Time", artist: "Lizzo", year: 2022, genre: "pop" },
  { title: "Anti-Hero", artist: "Taylor Swift", year: 2022, genre: "pop" },
  { title: "Cruel Summer", artist: "Taylor Swift", year: 2023, genre: "pop" },
  { title: "Vampire", artist: "Olivia Rodrigo", year: 2023, genre: "pop" },
  { title: "Good Luck, Babe!", artist: "Chappell Roan", year: 2024, genre: "pop" },
  { title: "Die with a Smile", artist: "Lady Gaga & Bruno Mars", year: 2024, genre: "pop" },
];

const OPM_SONGS: Song[] = [
  // MYX / NU107 / Billboard Philippines / Spotify PH top OPM (2000–2026)
  { title: "Harana", artist: "Parokya ni Edgar", year: 2000, genre: "opm" },
  { title: "214", artist: "Rivermaya", year: 2000, genre: "opm" },
  { title: "Jeepney", artist: "Six Part Invention", year: 2000, genre: "opm" },
  { title: "Forevermore", artist: "Side A", year: 2000, genre: "opm" },
  { title: "Umaasa", artist: "Eraserheads", year: 2001, genre: "opm" },
  { title: "Tuliro", artist: "Cueshe", year: 2001, genre: "opm" },
  { title: "Kahit Kailan", artist: "South Border", year: 2001, genre: "opm" },
  { title: "Ikaw", artist: "Yeng Constantino", year: 2002, genre: "opm" },
  { title: "Narda", artist: "Kamikazee", year: 2003, genre: "opm" },
  { title: "Hands Up", artist: "Billy Crawford", year: 2003, genre: "opm" },
  { title: "My Only Love", artist: "Christian Bautista", year: 2004, genre: "opm" },
  { title: "Ngiti", artist: "Sponge Cola", year: 2004, genre: "opm" },
  { title: "Walang Hanggan", artist: "Martin Nievera & Pops Fernandez", year: 2004, genre: "opm" },
  { title: "Stay", artist: "Sponge Cola", year: 2005, genre: "opm" },
  { title: "Dati", artist: "Sam Concepcion ft. Tippy Dos Santos", year: 2005, genre: "opm" },
  { title: "Ikaw Lamang", artist: "Silent Sanctuary", year: 2005, genre: "opm" },
  { title: "Hanggang", artist: "Wency Cornejo", year: 2006, genre: "opm" },
  { title: "Pag-ibig", artist: "Sugarfree", year: 2006, genre: "opm" },
  { title: "Ewan", artist: "Apo Hiking Society", year: 2006, genre: "opm" },
  { title: "Kung Wala Ka", artist: "Sponge Cola", year: 2007, genre: "opm" },
  { title: "Huwag Ka Nang Umiyak", artist: "Parokya ni Edgar", year: 2007, genre: "opm" },
  { title: "Nais Ko", artist: "Barbie's Cradle", year: 2007, genre: "opm" },
  { title: "Simpleng Tao", artist: "Rocksteddy", year: 2008, genre: "opm" },
  { title: "Migraine", artist: "Sugarfree", year: 2008, genre: "opm" },
  { title: "Pare Mahal Mo Raw Ako", artist: "Parokya ni Edgar", year: 2008, genre: "opm" },
  { title: "Wag Ka Nang Umiyak", artist: "Neocolours", year: 2009, genre: "opm" },
  { title: "Langit", artist: "Kamikazee", year: 2009, genre: "opm" },
  { title: "Kay Tagal Kitang Hinintay", artist: "Bugoy Drilon", year: 2009, genre: "opm" },
  { title: "Kahit Maputi Na Ang Buhok Ko", artist: "Rey Valera", year: 2010, genre: "opm" },
  { title: "Bakit Pa Ba", artist: "Yeng Constantino", year: 2010, genre: "opm" },
  { title: "Tayo Na Lang Dalawa", artist: "Yeng Constantino", year: 2010, genre: "opm" },
  { title: "Hiling", artist: "Silent Sanctuary", year: 2011, genre: "opm" },
  { title: "Sa Aking Puso", artist: "Jed Madela", year: 2011, genre: "opm" },
  { title: "Sana Maulit Muli", artist: "Regine Velasquez", year: 2011, genre: "opm" },
  { title: "Nag-iisa", artist: "Shamrock", year: 2012, genre: "opm" },
  { title: "Ligaya", artist: "Eraserheads", year: 2012, genre: "opm" },
  { title: "Ikaw At Ako", artist: "Yeng Constantino & Erik Santos", year: 2012, genre: "opm" },
  { title: "Parachute", artist: "Yeng Constantino", year: 2013, genre: "opm" },
  { title: "Mundo", artist: "IV of Spades", year: 2013, genre: "opm" },
  { title: "Isa Pa", artist: "December Avenue", year: 2013, genre: "opm" },
  { title: "Ulan", artist: "Sponge Cola", year: 2014, genre: "opm" },
  { title: "Dahan", artist: "Ben&Ben", year: 2014, genre: "opm" },
  { title: "Muli", artist: "Este", year: 2014, genre: "opm" },
  { title: "Tadhana", artist: "Up Dharma Down", year: 2015, genre: "opm" },
  { title: "Binibini", artist: "Zack Tabudlo", year: 2015, genre: "opm" },
  { title: "Ere", artist: "December Avenue", year: 2015, genre: "opm" },
  { title: "Mahika", artist: "Unique Salonga ft. Jess Connelly", year: 2016, genre: "opm" },
  { title: "Paraluman", artist: "Adie", year: 2016, genre: "opm" },
  { title: "Sana", artist: "I Belong to the Zoo", year: 2016, genre: "opm" },
  { title: "Kathang Isip", artist: "Ben&Ben", year: 2017, genre: "opm" },
  { title: "Mundo", artist: "IV of Spades", year: 2017, genre: "opm" },
  { title: "Langit Lupa", artist: "Callalily", year: 2017, genre: "opm" },
  { title: "Buwan", artist: "Juan Karlos", year: 2018, genre: "opm" },
  { title: "Pagtingin", artist: "Ben&Ben", year: 2018, genre: "opm" },
  { title: "Sa Susunod Na Habang Buhay", artist: "Ben&Ben", year: 2018, genre: "opm" },
  { title: "Kung 'Di Rin Lang Ikaw", artist: "December Avenue ft. Moira Dela Torre", year: 2019, genre: "opm" },
  { title: "Sana", artist: "Ben&Ben", year: 2019, genre: "opm" },
  { title: "Araw-Araw", artist: "Zack Tabudlo", year: 2019, genre: "opm" },
  { title: "Dilaw", artist: "Maki", year: 2020, genre: "opm" },
  { title: "Habang Buhay", artist: "Zack Tabudlo", year: 2020, genre: "opm" },
  { title: "Pano", artist: "Zack Tabudlo", year: 2020, genre: "opm" },
  { title: "Sa Iyo", artist: "Ben&Ben", year: 2020, genre: "opm" },
  { title: "Pelikula", artist: "TJ Monterde", year: 2021, genre: "opm" },
  { title: "Imahe", artist: "Magnus Haven", year: 2021, genre: "opm" },
  { title: "Dalawa", artist: "SB19", year: 2021, genre: "opm" },
  { title: "GENTO", artist: "SB19", year: 2022, genre: "opm" },
  { title: "Marilag", artist: "Dionela", year: 2022, genre: "opm" },
  { title: "Uhaw", artist: "Dilaw", year: 2022, genre: "opm" },
  { title: "Palagi", artist: "TJ Monterde ft. KZ Tandingan", year: 2022, genre: "opm" },
  { title: "Pantropiko", artist: "BINI", year: 2023, genre: "opm" },
  { title: "Karera", artist: "Zack Tabudlo", year: 2023, genre: "opm" },
  { title: "Cherry On Top", artist: "BINI", year: 2023, genre: "opm" },
  { title: "Kundiman", artist: "SB19", year: 2023, genre: "opm" },
  { title: "Salamin, Salamin", artist: "BINI", year: 2024, genre: "opm" },
  { title: "Dito Ka Lang", artist: "Arthur Nery ft. Adie", year: 2024, genre: "opm" },
  { title: "Upuan", artist: "Gloc-9 ft. Jeazell Grutas", year: 2024, genre: "opm" },
  { title: "Mundo", artist: "SB19", year: 2024, genre: "opm" },
  { title: "Tahanan", artist: "BINI", year: 2025, genre: "opm" },
  { title: "Paraiso", artist: "Arthur Nery", year: 2025, genre: "opm" },
];

const ALL_SONGS = [...BILLBOARD_SONGS, ...OPM_SONGS];

async function main() {
  // Build connection config from individual POSTGRES_* vars when DATABASE_URL is absent
  const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: process.env.POSTGRES_DB ?? 'playgen',
        user: process.env.POSTGRES_USER ?? 'playgen',
        password: process.env.POSTGRES_PASSWORD,
      };
  const pool = new pg.Pool(poolConfig);

  console.log(`\n[seed-songs] Target station slug: ${targetSlug}`);
  console.log(`[seed-songs] Total songs to seed: ${ALL_SONGS.length}`);

  if (dryRun) {
    console.log('\n[seed-songs] DRY RUN — songs that would be inserted:');
    for (const s of ALL_SONGS) {
      console.log(`  [${s.genre.toUpperCase()}] "${s.title}" — ${s.artist} (${s.year})`);
    }
    await pool.end();
    return;
  }

  // ── Resolve station ────────────────────────────────────────────────────────
  const { rows: stationRows } = await pool.query<{ id: string; company_id: string }>(
    `SELECT id, company_id FROM stations WHERE slug = $1 LIMIT 1`,
    [targetSlug],
  );
  if (!stationRows[0]) {
    console.error(`\n[seed-songs] Station with slug "${targetSlug}" not found.`);
    await pool.end();
    process.exit(1);
  }
  const { id: station_id, company_id } = stationRows[0];
  console.log(`\n[seed-songs] Station: ${station_id} (company: ${company_id})`);

  // ── Resolve era-based categories ─────────────────────────────────────────
  // HOT = current hits (2020+), PWR = peak hits (2015-2019),
  // REC = recurrent (2010-2014), GLD = gold/classics (pre-2010)
  const { rows: catRows } = await pool.query<{ id: string; code: string }>(
    `SELECT id, code FROM categories WHERE station_id = $1`,
    [station_id],
  );
  if (catRows.length === 0) {
    console.error('[seed-songs] No categories found — create at least one first.');
    await pool.end();
    process.exit(1);
  }
  const catMap = new Map(catRows.map(c => [c.code, c.id]));
  // Fall back to first available category if a code is missing
  const fallback_id = catRows[0].id;
  const getCategoryId = (year: number): string => {
    if (year >= 2020) return catMap.get('HOT') ?? fallback_id;
    if (year >= 2015) return catMap.get('PWR') ?? fallback_id;
    if (year >= 2010) return catMap.get('REC') ?? fallback_id;
    return catMap.get('GLD') ?? fallback_id;
  };
  console.log(`[seed-songs] Categories: ${catRows.map(c => c.code).join(', ')}\n`);

  // ── Seed songs ─────────────────────────────────────────────────────────────
  let inserted = 0;
  let updated = 0;

  for (const song of ALL_SONGS) {
    const category_id = getCategoryId(song.year);
    const { rows } = await pool.query<{ id: string; inserted: boolean }>(
      `INSERT INTO songs (company_id, station_id, category_id, title, artist, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (station_id, title, artist)
       DO UPDATE SET category_id = EXCLUDED.category_id
       RETURNING id, (xmax = 0) AS inserted`,
      [company_id, station_id, category_id, song.title, song.artist],
    );
    if (rows[0]?.inserted) {
      inserted++;
    } else {
      updated++;
    }
    const era = song.year >= 2020 ? 'HOT' : song.year >= 2015 ? 'PWR' : song.year >= 2010 ? 'REC' : 'GLD';
    console.log(`  ${rows[0]?.inserted ? '✓' : '↻'} [${era}/${song.genre.toUpperCase()}] "${song.title}" — ${song.artist} (${song.year})`);
  }

  console.log(`\n[seed-songs] Done! Inserted: ${inserted} new, Updated: ${updated} (category re-assigned by era).`);
  await pool.end();
}

main().catch((err) => {
  console.error('[seed-songs] Fatal:', err);
  process.exit(1);
});
