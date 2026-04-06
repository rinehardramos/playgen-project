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
 * Default script templates seeded for every new station.
 * One template per segment type with sensible defaults for common radio formats.
 * Safe to call multiple times — skips types already present.
 */
const DEFAULT_SCRIPT_TEMPLATES: Array<{ segment_type: string; name: string; prompt_template: string }> = [
  {
    segment_type: 'show_intro',
    name: 'Default Show Intro',
    prompt_template:
      'Open the show with energy and warmth. Welcome listeners to {{station_name}}, ' +
      'introduce yourself by name, and tease what\'s coming up — great music, maybe the weather or news. ' +
      'Keep it to 2–3 sentences. Make them feel like they tuned in at exactly the right moment.',
  },
  {
    segment_type: 'song_intro',
    name: 'Default Song Intro',
    prompt_template:
      'Introduce the next track: "{{next_song.artist}} with {{next_song.title}}". ' +
      'Add a brief, engaging comment about the song or artist — a fun fact, the vibe it sets, ' +
      'or a personal connection. 1–2 sentences maximum. Keep it natural.',
  },
  {
    segment_type: 'song_transition',
    name: 'Default Song Transition',
    prompt_template:
      'Bridge from "{{prev_song.title}}" by {{prev_song.artist}} to ' +
      '"{{next_song.title}}" by {{next_song.artist}}. ' +
      'Comment briefly on the outgoing track or link the two songs thematically. ' +
      '1–2 sentences — smooth and conversational.',
  },
  {
    segment_type: 'show_outro',
    name: 'Default Show Outro',
    prompt_template:
      'Wrap up the show warmly. Thank listeners for tuning in to {{station_name}}, ' +
      'sign off with your name, and let them know more great music is on the way. ' +
      '2 sentences max. End on a high note.',
  },
  {
    segment_type: 'station_id',
    name: 'Default Station ID',
    prompt_template:
      '{{#callsign}}You\'re listening to {{callsign}}{{/callsign}}{{^callsign}}This is {{station_name}}{{/callsign}}' +
      '{{#frequency}} — {{frequency}}{{/frequency}}' +
      '{{#tagline}}, {{tagline}}{{/tagline}}. ' +
      'Keep it punchy: 1 sentence, confident delivery.',
  },
  {
    segment_type: 'time_check',
    name: 'Default Time Check',
    prompt_template:
      'Drop a quick, natural time check: "It\'s {{current_time_local}} here on {{station_name}}." ' +
      'Feel free to tie it to what listeners might be doing at this hour. 1–2 sentences.',
  },
  {
    segment_type: 'weather_tease',
    name: 'Default Weather Tease',
    prompt_template:
      '{{#weather}}Give a quick, conversational weather update for {{station_city}}: {{weather_summary}}. ' +
      'Work it naturally into the show — tie it to what listeners might be doing or feeling. ' +
      'Keep it to 1–2 sentences.{{/weather}}' +
      '{{^weather}}Tease that weather info is coming up, or mention the weather vibe outside right now in one punchy sentence.{{/weather}}',
  },
  {
    segment_type: 'adlib',
    name: 'Default Adlib',
    prompt_template:
      'Drop a quick, spontaneous on-air comment — a shout-out, a fun fact, or a playful observation. ' +
      'Keep it under 2 sentences. Be natural, like you just thought of it.',
  },
  {
    segment_type: 'joke',
    name: 'Default Joke',
    prompt_template:
      'Tell a short, clean, family-friendly joke that fits the vibe of {{station_name}}. ' +
      'One setup, one punchline. Keep it light.',
  },
  {
    segment_type: 'current_events',
    name: 'Default Current Events',
    prompt_template:
      '{{#news}}Give a breezy, 1–2 sentence mention of what\'s happening in the news: ' +
      '"{{news_headline_1}}". Keep it light — no heavy politics, just conversational awareness.{{/news}}' +
      '{{^news}}Give a brief, upbeat mention of current local happenings or pop culture. Keep it under 2 sentences.{{/news}}',
  },
  {
    segment_type: 'listener_activity',
    name: 'Default Listener Activity',
    prompt_template:
      'Invite listeners to connect — shout out the station\'s social media, invite song requests, ' +
      'or tease an upcoming listener contest. Keep it energetic and under 3 sentences.',
  },
];

/**
 * Ensures a default DJ profile ("Alex") exists for the given company, then
 * creates daypart assignments mapping all time slots to that profile for the
 * given station. Also seeds default script templates for the station.
 * Safe to call multiple times — uses ON CONFLICT DO NOTHING.
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

  // Seed default script templates (one per segment type, skip existing)
  await seedDefaultScriptTemplates(stationId);
}

/**
 * Insert default script templates for a station, skipping any segment types
 * that already have a template. Safe to call multiple times.
 */
async function seedDefaultScriptTemplates(stationId: string): Promise<void> {
  const pool = getPool();

  // Guard: check whether dj_script_templates table exists
  const tableCheck = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'dj_script_templates'
     ) AS exists`,
  );
  if (!tableCheck.rows[0]?.exists) {
    console.warn('[station] dj_script_templates table not found — skipping template seed.');
    return;
  }

  for (const tmpl of DEFAULT_SCRIPT_TEMPLATES) {
    // Only insert if no template for this segment_type already exists on the station
    await pool.query(
      `INSERT INTO dj_script_templates (station_id, segment_type, name, prompt_template, is_active)
       SELECT $1, $2::dj_segment_type, $3, $4, TRUE
       WHERE NOT EXISTS (
         SELECT 1 FROM dj_script_templates
         WHERE station_id = $1 AND segment_type = $2::dj_segment_type
       )`,
      [stationId, tmpl.segment_type, tmpl.name, tmpl.prompt_template],
    );
  }

  console.log(`[station] Default script templates seeded for station ${stationId}`);
}
