-- Fix schema drift: old deployments may have extra NOT NULL columns
-- that don't exist in the canonical src migrations. Make them nullable.

-- dj_profiles: station_id and dj_profile_id may exist as NOT NULL
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dj_profiles' AND column_name='station_id') THEN
    ALTER TABLE dj_profiles ALTER COLUMN station_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dj_profiles' AND column_name='dj_profile_id') THEN
    ALTER TABLE dj_profiles ALTER COLUMN dj_profile_id DROP NOT NULL;
  END IF;
END $$;

-- dj_segments: old schema has dj_script_id, dj_profile_id, before_song_id, after_song_id as NOT NULL
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dj_segments' AND column_name='dj_script_id') THEN
    ALTER TABLE dj_segments ALTER COLUMN dj_script_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dj_segments' AND column_name='dj_profile_id') THEN
    ALTER TABLE dj_segments ALTER COLUMN dj_profile_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dj_segments' AND column_name='before_song_id') THEN
    ALTER TABLE dj_segments ALTER COLUMN before_song_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dj_segments' AND column_name='after_song_id') THEN
    ALTER TABLE dj_segments ALTER COLUMN after_song_id DROP NOT NULL;
  END IF;
END $$;

-- dj_scripts: old schema may have extra NOT NULL columns
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dj_scripts' AND column_name='station_id' AND is_nullable='NO') THEN
    ALTER TABLE dj_scripts ALTER COLUMN station_id DROP NOT NULL;
  END IF;
END $$;

-- dj_show_manifests: ensure station_id nullable
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dj_show_manifests' AND column_name='station_id' AND is_nullable='NO') THEN
    ALTER TABLE dj_show_manifests ALTER COLUMN station_id DROP NOT NULL;
  END IF;
END $$;
