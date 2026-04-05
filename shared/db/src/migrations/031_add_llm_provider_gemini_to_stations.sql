ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS gemini_api_key TEXT,
  ADD COLUMN IF NOT EXISTS llm_provider   TEXT NOT NULL DEFAULT 'openrouter';
