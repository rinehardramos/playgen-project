-- 067: Add themes JSONB to programs table
-- Themes are stackable directives that shape playlist selection + DJ script content.
-- Array of ProgramTheme objects with type, priority, active flag, and type-specific config.

ALTER TABLE programs ADD COLUMN IF NOT EXISTS themes JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN programs.themes IS 'Array of ProgramTheme objects — stackable theme directives with priority weights (weather, sponsored, custom, news, social, event, mood)';
