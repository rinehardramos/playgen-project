-- DJ default persona seed: "Alex" for the default PlayGen Radio company
-- Idempotent — safe to run multiple times (uses ON CONFLICT DO NOTHING)
-- Company: 00000000-0000-0000-0000-000000000001 (PlayGen Radio)

DO $$
DECLARE
  cid     UUID := '00000000-0000-0000-0000-000000000001';
  sid     UUID := '8edb1148-3423-43c7-9ffb-065aabdb3dfd';
  alex_id UUID := '11111111-0000-0000-0000-000000000001';
BEGIN

  -- ── Default DJ Profile: Alex ──────────────────────────────────────────────
  INSERT INTO dj_profiles (
    id, company_id, name, personality, voice_style,
    llm_model, llm_temperature,
    tts_provider, tts_voice_id,
    persona_config,
    is_default, is_active
  ) VALUES (
    alex_id,
    cid,
    'Alex',
    'You are Alex, an upbeat and charismatic radio DJ who loves music and connecting with listeners. '
    'You have a warm, friendly tone with just the right amount of energy — never over-the-top but always engaging. '
    'You know your music deeply: the artists, the stories, the eras. You keep things moving, '
    'bridge songs naturally, and make every listener feel like they''re tuning in to their favourite station.',
    'energetic',
    'anthropic/claude-sonnet-4-5',
    0.80,
    'openai',
    'alloy',
    '{"joke_style":"witty","humor_level":7,"energy_level":7,"formality":"casual"}'::jsonb,
    TRUE,
    TRUE
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── Enable DJ on Test Station ─────────────────────────────────────────────
  UPDATE stations
  SET dj_enabled = TRUE, dj_auto_approve = FALSE
  WHERE id = sid;

  -- ── Default daypart assignments for Test Station ──────────────────────────
  INSERT INTO dj_daypart_assignments (station_id, dj_profile_id, daypart, start_hour, end_hour)
  VALUES
    (sid, alex_id, 'overnight',  0,  6),
    (sid, alex_id, 'morning',    6, 12),
    (sid, alex_id, 'midday',    12, 15),
    (sid, alex_id, 'afternoon', 15, 19),
    (sid, alex_id, 'evening',   19, 24)
  ON CONFLICT (station_id, daypart) DO NOTHING;

END $$;
