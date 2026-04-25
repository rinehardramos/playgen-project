-- Widen position check constraints to support stations with more than 4 songs per hour.
-- Original constraint: position BETWEEN 1 AND 4
-- New constraint: position BETWEEN 1 AND 100

ALTER TABLE playlist_entries DROP CONSTRAINT IF EXISTS playlist_entries_position_check;
ALTER TABLE playlist_entries ADD CONSTRAINT playlist_entries_position_check CHECK (position BETWEEN 1 AND 100);

ALTER TABLE template_slots DROP CONSTRAINT IF EXISTS template_slots_position_check;
ALTER TABLE template_slots ADD CONSTRAINT template_slots_position_check CHECK (position BETWEEN 1 AND 100);
