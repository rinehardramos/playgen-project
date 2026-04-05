-- Add current_events segment type and news provider config columns (issue #208)
ALTER TYPE dj_segment_type ADD VALUE IF NOT EXISTS 'current_events';

-- Add news provider config columns to stations
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS news_provider  VARCHAR(50)  DEFAULT 'newsapi',
  ADD COLUMN IF NOT EXISTS news_api_key   TEXT;
