-- Podcast episodes: two-host dialogue shows rendered from an imported or
-- LLM-generated script, with a pluggable TTS voice per host (e.g. Mistral
-- Voxtral preset voices or an ElevenLabs cloned voice).
CREATE TABLE dj_podcast_episodes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id         uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  title              varchar(200) NOT NULL,
  source             varchar(20) NOT NULL DEFAULT 'imported',  -- imported | generated
  topic              text,
  script_text        text NOT NULL DEFAULT '',
  -- [{ "name": "Alex", "provider": "elevenlabs", "voice_id": "..." },
  --  { "name": "Sam",  "provider": "mistral",    "voice_id": "..." }]
  hosts              jsonb NOT NULL,
  status             varchar(20) NOT NULL DEFAULT 'pending',   -- pending | generating_script | rendering | ready | failed
  error_message      text,
  audio_url          text,
  audio_duration_sec numeric,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dj_podcast_episodes_station_idx
  ON dj_podcast_episodes (station_id, created_at DESC);
