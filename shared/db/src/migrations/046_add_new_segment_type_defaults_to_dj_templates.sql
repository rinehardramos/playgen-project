-- Insert default dj_script_templates for new segment types on all existing stations.
-- Only inserts if the station does not already have a template for that segment type.
-- New types: adlib, joke, current_events, listener_activity
-- Also upserts improved defaults for station_id and time_check.

INSERT INTO dj_script_templates (station_id, segment_type, name, prompt_template, is_active)
SELECT
    s.id,
    t.segment_type,
    t.name,
    t.prompt_template,
    TRUE
FROM stations s
CROSS JOIN (
    VALUES
    (
        'adlib'::dj_segment_type,
        'Default Adlib',
        'Drop a quick, spontaneous on-air comment — a shout-out, a fun fact, or a playful observation. Keep it under 2 sentences. Be natural, like you just thought of it.'
    ),
    (
        'joke'::dj_segment_type,
        'Default Joke',
        'Tell a short, clean, family-friendly joke that fits the vibe of {{station_name}}. One setup, one punchline.'
    ),
    (
        'current_events'::dj_segment_type,
        'Default Current Events',
        '{{#news}}Give a breezy, 1–2 sentence mention of what''s happening in the news: "{{news_headline_1}}". Keep it light — no heavy politics, just conversational awareness.{{/news}}{{^news}}Give a brief, upbeat mention of current local happenings or pop culture. Keep it under 2 sentences.{{/news}}'
    ),
    (
        'listener_activity'::dj_segment_type,
        'Default Listener Activity',
        'Invite listeners to connect — shout out the station''s social media, invite song requests, or tease an upcoming listener contest. Keep it energetic and under 3 sentences.'
    ),
    (
        'weather_tease'::dj_segment_type,
        'Default Weather Tease',
        '{{#weather}}Give a quick, conversational weather update for {{station_city}}: {{weather_summary}}. Work it naturally into the show — tie it to what listeners might be doing or feeling. Keep it to 1-2 sentences.{{/weather}}{{^weather}}Tease that weather info is coming up, or mention the weather vibe outside right now in one punchy sentence.{{/weather}}'
    )
) AS t(segment_type, name, prompt_template)
WHERE NOT EXISTS (
    SELECT 1
    FROM dj_script_templates dst
    WHERE dst.station_id = s.id
      AND dst.segment_type = t.segment_type
);
