-- Migration 076: Add station_spec JSONB column to stations
-- Stores the declarative station blueprint (like CLAUDE.md for stations).
-- Partial specs are valid — only present keys override station config.

ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS station_spec JSONB;

COMMENT ON COLUMN stations.station_spec IS
  'Declarative station blueprint (StationSpec). Drives DJ personality, script rules, and music guidelines at generation time. Partial specs are supported.';
