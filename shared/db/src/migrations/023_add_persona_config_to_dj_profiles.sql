-- Add structured personality traits as JSONB to DJ profiles
ALTER TABLE dj_profiles
  ADD COLUMN persona_config JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN dj_profiles.persona_config IS
  'Structured personality traits: catchphrases, signature_greeting, signature_signoff, topics_to_avoid, energy_level (1-10), humor_level (1-10), formality (casual/balanced/formal), backstory';
