-- Add Mistral API key to stations table (used for Voxtral TTS and Mistral LLM)
ALTER TABLE stations ADD COLUMN IF NOT EXISTS mistral_api_key TEXT;
