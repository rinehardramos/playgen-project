CREATE TABLE station_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(station_id, key)
);

COMMENT ON TABLE station_settings IS 'Per-station key-value configuration store for API keys, model selections, and other configurable settings';
COMMENT ON COLUMN station_settings.is_secret IS 'If true, the value is masked (***) in GET responses but still usable internally';

-- Known setting keys (informational; not seeded as data):
--   tts_provider   TEXT    — "elevenlabs" | "openai"  (default: elevenlabs)
--   tts_api_key    SECRET  — TTS provider API key
--   tts_voice_id   TEXT    — ElevenLabs voice ID or OpenAI voice name
--   llm_model      TEXT    — e.g. "anthropic/claude-sonnet-4-5"
--   llm_api_key    SECRET  — OpenRouter API key override (falls back to env OPENROUTER_API_KEY)
