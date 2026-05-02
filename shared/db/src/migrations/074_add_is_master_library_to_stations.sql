-- Migration 074: add is_master_library flag to stations
-- When true, this station's song library is used as a fallback for stations
-- that have no songs of their own (e.g. new stations from OwnRadio wizard).
-- COMMENT ON COLUMN stations.is_master_library: whether this station acts as the global fallback music library
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS is_master_library BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN stations.is_master_library IS 'When true, this station''''s songs are used as a fallback for stations with no music library assigned';
