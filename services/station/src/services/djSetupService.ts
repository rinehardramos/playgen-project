import { getPool } from '../db';

const DEFAULT_ALEX_PERSONALITY =
  "You are Alex, an upbeat and charismatic radio DJ who loves music and connecting with listeners. " +
  "You have a warm, friendly tone with just the right amount of energy — never over-the-top but always engaging. " +
  "You know your music deeply: the artists, the stories, the eras. You keep things moving, " +
  "bridge songs naturally, and make every listener feel like they're tuning in to their favourite station.";

const DEFAULT_PERSONA_CONFIG = {
  catchphrases: [
    "Keep it locked right here!",
    "That's what I'm talking about!",
    "Let's keep the good times rolling!",
  ],
  signature_greeting: "Hey hey hey, you're live with Alex on {{station_name}}!",
  signature_signoff: "Stay tuned, stay awesome, and remember — the best music is right here.",
  topics_to_avoid: ["politics", "religion", "controversial news"],
  energy_level: 7,
  humor_level: 6,
  formality: "casual",
  backstory:
    "Alex has been in radio for over a decade, starting as an intern at a college station. " +
    "Known for incredible music taste spanning genres and a knack for making every listener " +
    "feel like they're the only one tuning in. Off air, Alex is a vinyl collector and " +
    "weekend festival-goer who brings that live-music energy to every broadcast.",
};

const DAYPARTS = [
  { daypart: 'overnight',  start_hour: 0,  end_hour: 6  },
  { daypart: 'morning',    start_hour: 6,  end_hour: 12 },
  { daypart: 'midday',     start_hour: 12, end_hour: 15 },
  { daypart: 'afternoon',  start_hour: 15, end_hour: 19 },
  { daypart: 'evening',    start_hour: 19, end_hour: 23 },
] as const;

/**
 * Ensures a default DJ profile ("Alex") exists for the given company, then
 * creates daypart assignments mapping all time slots to that profile for the
 * given station. Safe to call multiple times — uses ON CONFLICT DO NOTHING.
 */
export async function seedDefaultDjProfileForStation(
  companyId: string,
  stationId: string,
): Promise<void> {
  const pool = getPool();

  // Check whether the dj_profiles table exists (guard for environments where
  // DJ migrations haven't been applied yet)
  const tableCheck = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'dj_profiles'
     ) AS exists`,
  );
  if (!tableCheck.rows[0]?.exists) {
    console.warn('[station] dj_profiles table not found — skipping DJ profile seed.');
    return;
  }

  // Find or create the default DJ profile for this company
  const existingProfile = await pool.query<{ id: string }>(
    'SELECT id FROM dj_profiles WHERE company_id = $1 AND is_default = TRUE LIMIT 1',
    [companyId],
  );

  let profileId: string;

  if (existingProfile.rowCount && existingProfile.rowCount > 0) {
    profileId = existingProfile.rows[0].id;
    console.log(`[station] Reusing existing default DJ profile ${profileId} for company ${companyId}`);
  } else {
    // Create the default "Alex" profile for this company
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO dj_profiles (
         company_id, name, personality, voice_style, persona_config,
         llm_model, llm_temperature, tts_provider, tts_voice_id,
         is_default, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        companyId,
        'Alex',
        DEFAULT_ALEX_PERSONALITY,
        'energetic',
        JSON.stringify(DEFAULT_PERSONA_CONFIG),
        'anthropic/claude-sonnet-4-5',
        0.80,
        'openai',
        'alloy',
        true,
        true,
      ],
    );
    profileId = inserted.rows[0].id;
    console.log(`[station] Created default DJ profile "Alex" (${profileId}) for company ${companyId}`);
  }

  // Create daypart assignments for the new station
  for (const { daypart, start_hour, end_hour } of DAYPARTS) {
    await pool.query(
      `INSERT INTO dj_daypart_assignments
         (station_id, dj_profile_id, daypart, start_hour, end_hour)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (station_id, daypart) DO NOTHING`,
      [stationId, profileId, daypart, start_hour, end_hour],
    );
  }

  console.log(`[station] Default daypart assignments seeded for station ${stationId}`);
}
