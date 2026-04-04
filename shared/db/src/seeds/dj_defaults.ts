import { Pool } from 'pg';

const DEFAULT_DJ = {
  name: "Alex",
  tone: "friendly",
  energy_level: "medium",
  persona_prompt: `You are Alex, a charismatic and knowledgeable radio DJ with 10 years of experience.
You have a warm, conversational style that makes listeners feel like they're chatting
with a friend. You know your music deeply — you can speak about an artist's journey,
what makes a song special, and how it fits the moment. You keep energy up without
being over the top. You're witty but never try-hard. You connect songs with smooth,
natural transitions that feel effortless.`,
  catchphrases: [
    "You're listening to the best music in the city.",
    "Let's keep the vibes going.",
    "That one never gets old."
  ],
  voice_config: {
    provider: "openai",
    voice_id: "nova",
    speed: 1.0
  },
  is_default: true
};

const DEFAULT_TEMPLATES = [
  { type: 'show_open', template: "Good {{time_of_day}}, {{station_name}}! I'm {{dj_name}} and we're kicking things off with {{song_title}} by {{artist}}." },
  { type: 'segue', template: "That was {{prev_artist}} with '{{prev_song}}'. Coming up — {{artist}} with '{{song_title}}'." },
  { type: 'song_intro', template: "Next up, {{artist}} with '{{song_title}}'." },
  { type: 'time_check', template: "It's {{time}} — you're locked in with {{dj_name}} on {{station_name}}." },
  { type: 'station_id', template: "{{station_name}} — playing the best music all day." },
  { type: 'show_close', template: "That's a wrap from me, {{dj_name}}. Keep those vibes going." }
];

export async function seedDJDefaults(pool: Pool) {
  const { rows: stations } = await pool.query('SELECT id FROM stations');

  for (const station of stations) {
    const stationId = station.id;

    // 1. Seed default DJ Profile if none exists
    const { rowCount: djCount } = await pool.query(
      'SELECT 1 FROM dj_profiles WHERE station_id = $1 AND is_default = TRUE',
      [stationId]
    );

    if (djCount === 0) {
      console.log(`Seeding default DJ for station ${stationId}`);
      await pool.query(
        `INSERT INTO dj_profiles (
          station_id, name, persona_prompt, tone, energy_level, catchphrases, voice_config, is_default
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          stationId, DEFAULT_DJ.name, DEFAULT_DJ.persona_prompt, DEFAULT_DJ.tone, 
          DEFAULT_DJ.energy_level, DEFAULT_DJ.catchphrases, DEFAULT_DJ.voice_config, DEFAULT_DJ.is_default
        ]
      );
    }

    // 2. Seed default script templates
    for (const t of DEFAULT_TEMPLATES) {
      const { rowCount: tCount } = await pool.query(
        'SELECT 1 FROM dj_script_templates WHERE station_id = $1 AND segment_type = $2',
        [stationId, t.type]
      );

      if (tCount === 0) {
        await pool.query(
          'INSERT INTO dj_script_templates (station_id, segment_type, prompt_template) VALUES ($1, $2, $3)',
          [stationId, t.type, t.template]
        );
      }
    }
  }
}
