-- Migration 030: Add rejection_notes to dj_segments for per-segment reject instruction audit trail
ALTER TABLE dj_segments
  ADD COLUMN IF NOT EXISTS rejection_notes TEXT;
