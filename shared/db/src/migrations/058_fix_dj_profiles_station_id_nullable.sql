-- Fix schema drift: old deployments have station_id NOT NULL on dj_profiles,
-- but profiles are company-scoped (not station-scoped). Make nullable if exists.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dj_profiles' AND column_name = 'station_id'
  ) THEN
    ALTER TABLE dj_profiles ALTER COLUMN station_id DROP NOT NULL;
    ALTER TABLE dj_profiles ALTER COLUMN station_id SET DEFAULT NULL;
  END IF;
END $$;
