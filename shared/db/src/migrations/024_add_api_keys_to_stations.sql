-- Add API keys to stations for AI DJ services
ALTER TABLE stations
    ADD COLUMN openai_api_key      TEXT,
    ADD COLUMN elevenlabs_api_key  TEXT,
    ADD COLUMN openrouter_api_key  TEXT;
