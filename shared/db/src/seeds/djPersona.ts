import { Pool } from 'pg';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_STATION_ID = '8edb1148-3423-43c7-9ffb-065aabdb3dfd';
const ALEX_PROFILE_ID   = '11111111-0000-0000-0000-000000000001';

export async function seedDjPersona(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Skip if Alex already exists
    const existing = await client.query(
      'SELECT id FROM dj_profiles WHERE id = $1',
      [ALEX_PROFILE_ID],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      console.log('[seed] DJ persona "Alex" already exists, skipping.');
      return;
    }

    // Check that dj_profiles table exists (migrations may not have run yet)
    const tableExists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'dj_profiles'`,
    );
    if (!tableExists.rowCount) {
      console.warn('[seed] dj_profiles table not found, skipping DJ persona seed.');
      return;
    }

    await client.query(
      `INSERT INTO dj_profiles (
        id, company_id, name, personality, voice_style,
        llm_model, llm_temperature, tts_provider, tts_voice_id,
        is_default, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO NOTHING`,
      [
        ALEX_PROFILE_ID,
        DEFAULT_COMPANY_ID,
        'Alex',
        "You are Alex, an upbeat and charismatic radio DJ who loves music and connecting with listeners. " +
        "You have a warm, friendly tone with just the right amount of energy — never over-the-top but always engaging. " +
        "You know your music deeply: the artists, the stories, the eras. You keep things moving, " +
        "bridge songs naturally, and make every listener feel like they're tuning in to their favourite station.",
        'energetic',
        'anthropic/claude-sonnet-4-5',
        0.80,
        'openai',
        'alloy',
        true,
        true,
      ],
    );

    // Enable DJ on default station
    await client.query(
      `UPDATE stations SET dj_enabled = TRUE, dj_auto_approve = FALSE WHERE id = $1`,
      [DEFAULT_STATION_ID],
    );

    // Seed default daypart assignments
    const dayparts = [
      ['overnight',   0,  6],
      ['morning',     6, 12],
      ['midday',     12, 15],
      ['afternoon',  15, 19],
      ['evening',    19, 24],
    ] as const;

    for (const [daypart, start_hour, end_hour] of dayparts) {
      await client.query(
        `INSERT INTO dj_daypart_assignments
           (station_id, dj_profile_id, daypart, start_hour, end_hour)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (station_id, daypart) DO NOTHING`,
        [DEFAULT_STATION_ID, ALEX_PROFILE_ID, daypart, start_hour, end_hour],
      );
    }

    console.log('[seed] DJ persona "Alex" created with default daypart assignments.');
  } finally {
    client.release();
  }
}
