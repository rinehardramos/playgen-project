-- Migration 072: Add artwork_url to stations
-- Stores the DALL-E generated abstract cover art URL for each station.
-- Separate from logo_url (which is user-uploaded branding).
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS artwork_url VARCHAR(1000);
