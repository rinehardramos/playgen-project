-- Add auto-approve toggle to stations: skips the script review gate when TRUE
ALTER TABLE stations
    ADD COLUMN dj_auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN dj_enabled      BOOLEAN NOT NULL DEFAULT FALSE;
