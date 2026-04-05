-- Create program_episodes table (issue #210: Program as higher-tier entity)
-- An Episode is a single air-date instance of a Program.
-- It links together the playlist, DJ script, and manifest for one broadcast.

CREATE TYPE episode_status AS ENUM ('draft', 'generating', 'ready', 'approved', 'aired');

CREATE TABLE IF NOT EXISTS program_episodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id      UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    air_date        DATE NOT NULL,
    playlist_id     UUID REFERENCES playlists(id) ON DELETE SET NULL,
    dj_script_id    UUID REFERENCES dj_scripts(id) ON DELETE SET NULL,
    manifest_id     UUID REFERENCES dj_show_manifests(id) ON DELETE SET NULL,
    status          episode_status NOT NULL DEFAULT 'draft',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (program_id, air_date)
);

CREATE INDEX IF NOT EXISTS idx_program_episodes_program   ON program_episodes(program_id);
CREATE INDEX IF NOT EXISTS idx_program_episodes_air_date  ON program_episodes(program_id, air_date DESC);
CREATE INDEX IF NOT EXISTS idx_program_episodes_playlist  ON program_episodes(playlist_id) WHERE playlist_id IS NOT NULL;

-- Back-fill: create a default "Unassigned" program for each station and link
-- existing playlists to episodes under that program.
-- Uses a DO block so it's idempotent on re-run.
DO $$
DECLARE
    rec RECORD;
    default_program_id UUID;
BEGIN
    FOR rec IN SELECT DISTINCT station_id FROM playlists LOOP
        -- Get or create the default program for this station
        SELECT id INTO default_program_id
        FROM programs
        WHERE station_id = rec.station_id AND name = 'Unassigned';

        IF default_program_id IS NULL THEN
            INSERT INTO programs (station_id, name, description, is_active)
            VALUES (rec.station_id, 'Unassigned', 'Auto-created default program for pre-Program playlists', FALSE)
            RETURNING id INTO default_program_id;
        END IF;

        -- Create an episode for each playlist that doesn't have one yet
        INSERT INTO program_episodes (program_id, air_date, playlist_id, dj_script_id, status)
        SELECT
            default_program_id,
            p.date,
            p.id,
            ds.id,
            CASE
                WHEN ds.review_status = 'approved' OR ds.review_status = 'auto_approved' THEN 'approved'::episode_status
                ELSE 'ready'::episode_status
            END
        FROM playlists p
        LEFT JOIN dj_scripts ds ON ds.playlist_id = p.id
        WHERE p.station_id = rec.station_id
          AND NOT EXISTS (
              SELECT 1 FROM program_episodes pe WHERE pe.playlist_id = p.id
          )
        ON CONFLICT (program_id, air_date) DO NOTHING;
    END LOOP;
END
$$;
