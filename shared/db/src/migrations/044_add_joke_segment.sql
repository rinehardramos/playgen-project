-- Migration 044: Add 'joke' value to dj_segment_type enum
-- Idempotent — ADD VALUE IF NOT EXISTS is safe to run multiple times

ALTER TYPE dj_segment_type ADD VALUE IF NOT EXISTS 'joke';
