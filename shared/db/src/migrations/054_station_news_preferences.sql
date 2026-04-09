-- Migration 054: per-station news scope + topic preferences
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS news_scope TEXT NOT NULL DEFAULT 'global'
    CHECK (news_scope IN ('global','country','local')),
  ADD COLUMN IF NOT EXISTS news_topic TEXT NOT NULL DEFAULT 'any'
    CHECK (news_topic IN ('breaking','tech','music','entertainment','sports',
                          'business','science','health','politics','world','any'));
