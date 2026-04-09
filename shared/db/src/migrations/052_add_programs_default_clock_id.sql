-- Migration 052: Add default_clock_id FK to programs
-- Enables Clock-driven playlist generation (issue #291).

ALTER TABLE programs
  ADD COLUMN default_clock_id UUID REFERENCES show_format_clocks(id) ON DELETE SET NULL;

CREATE INDEX idx_programs_default_clock
  ON programs(default_clock_id)
  WHERE default_clock_id IS NOT NULL;
