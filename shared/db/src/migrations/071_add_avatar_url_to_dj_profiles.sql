-- Migration 071: Add avatar_url to dj_profiles
-- Stores the DALL-E generated portrait URL for each DJ profile.
ALTER TABLE dj_profiles
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(1000);
