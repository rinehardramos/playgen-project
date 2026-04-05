-- Adds 'joke' value to the dj_segment_type enum.
-- Uses pg_enum catalog insert because ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction block, and the migrate runner wraps all migrations.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'joke'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'dj_segment_type')
  ) THEN
    INSERT INTO pg_enum (enumtypid, enumlabel, enumsortorder)
    SELECT
      (SELECT oid FROM pg_type WHERE typname = 'dj_segment_type'),
      'joke',
      (SELECT MAX(enumsortorder) + 1 FROM pg_enum
       WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'dj_segment_type'));
  END IF;
END $$;
