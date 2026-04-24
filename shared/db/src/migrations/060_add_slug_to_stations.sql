-- Add slug column to stations for OwnRadio webhook routing.
-- Nullable so existing stations are unaffected; unique where set.
ALTER TABLE stations ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS stations_slug_unique ON stations (slug) WHERE slug IS NOT NULL;
