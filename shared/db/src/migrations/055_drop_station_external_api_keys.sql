-- Migration 055: drop per-station external API key columns
-- External API keys are now centrally managed by the info-broker service.
-- The DJ service no longer reads weather_api_key or news_api_key from stations.
ALTER TABLE stations DROP COLUMN IF EXISTS weather_api_key;
ALTER TABLE stations DROP COLUMN IF EXISTS news_api_key;
