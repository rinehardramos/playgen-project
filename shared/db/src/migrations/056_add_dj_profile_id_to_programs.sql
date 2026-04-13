-- T-I: DJ profile on Today's Now Playing card (issue #299)
-- Allows a program to declare which DJ profile hosts its hours,
-- surfaced in the /today Now Playing card.
ALTER TABLE programs
  ADD COLUMN dj_profile_id UUID REFERENCES dj_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN programs.dj_profile_id IS 'Optional DJ profile that hosts this program. Displayed on the /today Now Playing card (T-I).';
