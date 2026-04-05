-- Migration 039: Add station details columns
-- Identity, locale, social media, and branding fields for the Station Details page.
-- All columns are nullable to preserve backward compatibility.

ALTER TABLE stations
  -- Identity
  ADD COLUMN IF NOT EXISTS callsign VARCHAR(10),
  ADD COLUMN IF NOT EXISTS tagline VARCHAR(255),
  ADD COLUMN IF NOT EXISTS frequency VARCHAR(20),
  ADD COLUMN IF NOT EXISTS broadcast_type VARCHAR(20) DEFAULT 'fm'
    CHECK (broadcast_type IN ('fm', 'am', 'online', 'podcast', 'dab')),

  -- Locale
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS province VARCHAR(100),
  ADD COLUMN IF NOT EXISTS country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS locale_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(9,6),

  -- Social media
  ADD COLUMN IF NOT EXISTS facebook_page_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS facebook_page_url VARCHAR(255),
  ADD COLUMN IF NOT EXISTS twitter_handle VARCHAR(100),
  ADD COLUMN IF NOT EXISTS instagram_handle VARCHAR(100),
  ADD COLUMN IF NOT EXISTS youtube_channel_url VARCHAR(255),

  -- Branding
  ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7),
  ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(7),
  ADD COLUMN IF NOT EXISTS website_url VARCHAR(255);
