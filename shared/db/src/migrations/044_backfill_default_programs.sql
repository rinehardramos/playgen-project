-- Migration 037: Backfill default programs and link existing playlists as episodes
-- For every station, creates one default "Unassigned" program that acts as a
-- catch-all for all pre-existing playlists. Zero destructive changes — pure INSERTs.
-- After this migration, every existing playlist has a program_episodes record,
-- making the Programs > Episodes view immediately usable for all existing data.

-- Step 1: Create one default program per station
INSERT INTO programs (
    station_id,
    name,
    description,
    active_days,
    start_hour,
    end_hour,
    is_default,
    is_active
)
SELECT
    id AS station_id,
    'Unassigned' AS name,
    'Auto-created program for pre-existing playlists. Rename or reassign episodes to a named program.' AS description,
    ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] AS active_days,
    0 AS start_hour,
    24 AS end_hour,
    TRUE AS is_default,
    TRUE AS is_active
FROM stations
ON CONFLICT (station_id, name) DO NOTHING;

-- Step 2: Link every existing playlist to its station's default program
INSERT INTO program_episodes (
    program_id,
    playlist_id,
    air_date
)
SELECT
    p.id AS program_id,
    pl.id AS playlist_id,
    pl.date AS air_date
FROM playlists pl
JOIN programs p
    ON p.station_id = pl.station_id
    AND p.is_default = TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM program_episodes pe WHERE pe.playlist_id = pl.id
);
