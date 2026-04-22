/**
 * Seed script: Creates 4 classic FM radio DJ personas for OwnRadio's full-day program
 * and assigns each to their daypart.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node dist/seeds/dj-personas.js
 *
 * Idempotent — safe to run multiple times. Uses ON CONFLICT to skip existing rows.
 * Targets the first company and station found in the database.
 */

import { getPool } from '../client';

async function seed() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    // Guard: dj_profiles table must exist
    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'dj_profiles'`,
    );
    if (!tableCheck.rowCount) {
      console.warn('[seed] dj_profiles table not found — run migrations first.');
      return;
    }

    // Resolve first company and station dynamically
    const { rows: companyRows } = await client.query<{ id: string }>(
      'SELECT id FROM companies LIMIT 1',
    );
    const { rows: stationRows } = await client.query<{ id: string }>(
      'SELECT id FROM stations LIMIT 1',
    );

    if (!companyRows[0] || !stationRows[0]) {
      console.error('[seed] No company or station found — seed admin first.');
      return;
    }

    const companyId = companyRows[0].id;
    const stationId = stationRows[0].id;

    // ── DJ Profiles ──────────────────────────────────────────────────────────
    const profiles: Array<{
      name: string;
      personality: string;
      voice_style: string;
      llm_temperature: number;
      tts_voice_id: string;
      persona_config: object;
    }> = [
      {
        name: 'DJ Mike',
        personality:
          'High-energy morning host who thrives on getting people pumped for the day. ' +
          'News-savvy, loves coffee references, quick-witted.',
        voice_style: 'energetic',
        llm_temperature: 0.85,
        tts_voice_id: 'echo',
        persona_config: {
          backstory:
            'Former college radio DJ who turned his passion into a career. Known for his ' +
            'infectious energy and ability to make even Monday mornings feel exciting.',
          energy_level: 9,
          humor_level: 7,
          formality: 'casual',
          catchphrases: [
            'Rise and grind!',
            "Let's get this morning started!",
            "Coffee's hot, music's hotter!",
          ],
          signature_greeting: 'Good morning, OwnRadio fam! DJ Mike in the house!',
          signature_signoff:
            "That's your morning wrapped — DJ Mike signing off. Stay awesome!",
          topics_to_avoid: ['politics', 'religion'],
          joke_style: 'dad',
        },
      },
      {
        name: 'DJ Luna',
        personality:
          'Warm, conversational midday companion. Music encyclopedia who loves sharing ' +
          'artist stories and fun facts. Calming presence.',
        voice_style: 'warm',
        llm_temperature: 0.75,
        tts_voice_id: 'nova',
        persona_config: {
          backstory:
            'Music journalist turned DJ who brings deep artist knowledge and a soothing midday ' +
            "presence. Listeners feel like they're chatting with a friend.",
          energy_level: 5,
          humor_level: 5,
          formality: 'balanced',
          catchphrases: [
            "Here's a fun fact for you...",
            'Music is medicine, friends',
            'Let the music do the talking',
          ],
          signature_greeting: "Hey there, it's Luna keeping you company through the midday",
          signature_signoff: 'Luna here, wishing you a beautiful rest of your day. Keep listening!',
          topics_to_avoid: ['controversy'],
          joke_style: 'witty',
        },
      },
      {
        name: 'DJ Rex',
        personality:
          'Bold, fun, pop-culture obsessed afternoon driver. Gets people hyped for the evening. ' +
          'Loves countdowns and listener interaction.',
        voice_style: 'bold',
        llm_temperature: 0.9,
        tts_voice_id: 'onyx',
        persona_config: {
          backstory:
            'Former club DJ who brings that weekend energy to every weekday afternoon. Known for ' +
            'his legendary countdown segments and surprise drops.',
          energy_level: 8,
          humor_level: 8,
          formality: 'casual',
          catchphrases: ["Let's turn it UP!", 'Drive time, baby!', "Who's ready to roll?"],
          signature_greeting:
            "What's good, OwnRadio! DJ Rex coming at you LIVE for the afternoon drive!",
          signature_signoff:
            "DJ Rex out! Don't forget — the party doesn't stop on OwnRadio!",
          topics_to_avoid: ['politics'],
          joke_style: 'sarcastic',
        },
      },
      {
        name: 'DJ Nyx',
        personality:
          'Chill, smooth late-night host. Introspective and mellow. Creates an intimate ' +
          'listening experience with thoughtful song selections.',
        voice_style: 'smooth',
        llm_temperature: 0.7,
        tts_voice_id: 'alloy',
        persona_config: {
          backstory:
            'Night owl poet and vinyl collector. Creates intimate late-night vibes where every ' +
            'song feels like it was picked just for you.',
          energy_level: 3,
          humor_level: 4,
          formality: 'balanced',
          catchphrases: ['Settle in...', "This next one's special", 'The night is young'],
          signature_greeting:
            'Good evening, night owls. DJ Nyx here, your companion through the night',
          signature_signoff: 'This is Nyx, signing off into the night. Sweet dreams, OwnRadio.',
          topics_to_avoid: ['loud', 'controversy'],
          joke_style: 'observational',
        },
      },
    ];

    // Upsert each profile — conflict on (company_id, name) would be ideal but the schema
    // only has a unique index on (company_id) WHERE is_default = TRUE.
    // We use name + company_id existence check for idempotency instead.
    const profileIds: Record<string, string> = {};

    for (const p of profiles) {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM dj_profiles WHERE company_id = $1 AND name = $2',
        [companyId, p.name],
      );

      if (existing.rowCount && existing.rowCount > 0) {
        profileIds[p.name] = existing.rows[0].id;
        console.log(`[seed] DJ profile "${p.name}" already exists, skipping.`);
        continue;
      }

      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO dj_profiles (
          company_id, name, personality, voice_style,
          llm_model, llm_temperature,
          tts_provider, tts_voice_id,
          persona_config, is_default, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id`,
        [
          companyId,
          p.name,
          p.personality,
          p.voice_style,
          'anthropic/claude-sonnet-4-5',
          p.llm_temperature,
          'openai',
          p.tts_voice_id,
          JSON.stringify(p.persona_config),
          false,
          true,
        ],
      );

      profileIds[p.name] = inserted[0].id;
      console.log(`[seed] DJ profile "${p.name}" created (id: ${inserted[0].id}).`);
    }

    // ── Daypart Assignments ───────────────────────────────────────────────────
    const daypartAssignments: Array<{
      dj: string;
      daypart: 'morning' | 'midday' | 'afternoon' | 'evening';
      start_hour: number;
      end_hour: number;
    }> = [
      { dj: 'DJ Mike', daypart: 'morning',   start_hour: 6,  end_hour: 10 },
      { dj: 'DJ Luna', daypart: 'midday',    start_hour: 10, end_hour: 14 },
      { dj: 'DJ Rex',  daypart: 'afternoon', start_hour: 14, end_hour: 18 },
      { dj: 'DJ Nyx',  daypart: 'evening',   start_hour: 18, end_hour: 23 },
    ];

    for (const a of daypartAssignments) {
      const djId = profileIds[a.dj];
      if (!djId) {
        console.warn(`[seed] No profile ID found for "${a.dj}", skipping daypart assignment.`);
        continue;
      }

      await client.query(
        `INSERT INTO dj_daypart_assignments
           (station_id, dj_profile_id, daypart, start_hour, end_hour)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (station_id, daypart) DO UPDATE
           SET dj_profile_id = EXCLUDED.dj_profile_id,
               start_hour    = EXCLUDED.start_hour,
               end_hour      = EXCLUDED.end_hour`,
        [stationId, djId, a.daypart, a.start_hour, a.end_hour],
      );

      console.log(
        `[seed] Daypart "${a.daypart}" assigned to "${a.dj}" ` +
        `(${a.start_hour}:00–${a.end_hour}:00).`,
      );
    }

    console.log('[seed] DJ personas seeded successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
