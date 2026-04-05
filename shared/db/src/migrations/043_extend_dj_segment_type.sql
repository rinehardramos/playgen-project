-- Migration 036: Extend dj_segment_type enum with new content block types
-- These map to the new features: adlibs, jokes, current events, listener activity.
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is safe (additive, no table rewrite).

ALTER TYPE dj_segment_type ADD VALUE IF NOT EXISTS 'adlib';
ALTER TYPE dj_segment_type ADD VALUE IF NOT EXISTS 'joke';
ALTER TYPE dj_segment_type ADD VALUE IF NOT EXISTS 'current_events';
ALTER TYPE dj_segment_type ADD VALUE IF NOT EXISTS 'listener_activity';
