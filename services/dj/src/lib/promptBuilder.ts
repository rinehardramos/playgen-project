import type { DjProfile, DjSegmentType, NewsHeadline, PersonaConfig } from '@playgen/types';
import type { WeatherResponse, NewsItem, JokeResponse } from '@playgen/info-broker-client';
import { sanitizeUntrusted, wrapUntrusted } from './promptGuard.js';

/** Legacy alias kept for callers that reference WeatherData. */
export type WeatherData = WeatherResponse;

// Per-field length caps for user-supplied content flowing into prompts.
// Generous enough for legitimate use, hostile to payload smuggling.
const LIMITS = {
  name: 100,
  personality: 1000,
  voice_style: 500,
  backstory: 2000,
  catchphrase: 200,
  greeting: 300,
  topic: 100,
  station_field: 200,
  custom_template: 4000,
  listener_name: 100,
  listener_message: 500,
} as const;

const s = sanitizeUntrusted;

export type { WeatherResponse, NewsItem };

export interface SongContext {
  title: string;
  artist: string;
  duration_sec: number | null;
  album?: string | null;
  release_year?: number | null;
  genres?: string[] | null;
  /** Trivia from broker — UNTRUSTED, sanitized via promptGuard before LLM injection. */
  trivia?: string | null;
}

export interface ShoutoutContext {
  listener_name: string;
  listener_message: string;
}

/** Station identity fields sourced from the station_details columns (migration 039). */
export interface StationIdentity {
  callsign?: string | null;
  tagline?: string | null;
  frequency?: string | null;
  city?: string | null;
}

export interface ScriptContext {
  station_name: string;
  station_timezone: string;
  station_identity?: StationIdentity;
  station_city?: string;  // kept for backward compat; prefer station_identity.city
  current_date: string;    // YYYY-MM-DD
  current_hour: number;
  /** Human-readable local time string, e.g. "3:47 PM" — used for time_check segments. */
  current_time_local?: string;
  dj_profile: DjProfile;
  prev_song?: SongContext;
  next_song?: SongContext;
  segment_type: DjSegmentType;
  custom_template?: string;  // overrides default prompt when set
  shoutout?: ShoutoutContext;    // populated for listener_activity segments
  news_headlines?: NewsHeadline[]; // populated for current_events segments (legacy)
  weather?: WeatherData;
  news_items?: NewsItem[];
  /** Texts of recently generated segments — used to enforce variety */
  previousSegmentTexts?: string[];
  /** 0-based position of this segment in the full script */
  segmentIndex?: number;
  /** Joke style — sourced from persona_config.joke_style, used for joke segments. */
  joke_style?: string;
  /** Joke from broker — optional, present only for joke segments. */
  broker_joke?: JokeResponse;
}

// Map energy level (1-10) to descriptive text
function energyDescription(level: number): string {
  if (level <= 3) return 'Keep your energy low-key and chill. Speak in a relaxed, laid-back manner.';
  if (level <= 6) return 'Maintain a warm, moderate energy level. Friendly but not over-the-top.';
  if (level <= 8) return 'Bring high energy and enthusiasm. Be upbeat and engaging.';
  return 'Maximum energy! Be electric, hype, and larger-than-life on air.';
}

// Map humor level (1-10) to descriptive text
function humorDescription(level: number): string {
  if (level <= 3) return 'Keep it straight and professional — minimal jokes or banter.';
  if (level <= 6) return 'Sprinkle in light humor naturally. A witty comment here and there.';
  if (level <= 8) return 'Be playful and funny. Work in jokes, puns, and entertaining commentary.';
  return 'Go all-in on comedy. Be hilarious, use callbacks, and keep listeners laughing.';
}

// Map formality to descriptive text
function formalityDescription(formality: string): string {
  switch (formality) {
    case 'casual': return 'Speak casually, like talking to a friend. Use slang and colloquialisms naturally.';
    case 'formal': return 'Maintain a polished, professional broadcast tone. Proper grammar, no slang.';
    default: return 'Strike a balance between professional and approachable.';
  }
}

// Build the structured persona section from persona_config.
// All user-supplied strings are sanitized + length-capped here so injection
// payloads (bidi smuggling, control chars, "ignore instructions" blobs) cannot
// reach the LLM verbatim. Free-form fields are wrapped in <untrusted> delimiters
// so the model treats them as character data, not instructions.
function buildPersonaSection(config: PersonaConfig): string {
  const parts: string[] = [];

  if (config.backstory) {
    parts.push(`Backstory: ${wrapUntrusted('persona.backstory', config.backstory, LIMITS.backstory)}`);
  }

  if (config.energy_level != null) {
    parts.push(energyDescription(config.energy_level));
  }

  if (config.humor_level != null) {
    parts.push(humorDescription(config.humor_level));
  }

  if (config.formality) {
    parts.push(formalityDescription(config.formality));
  }

  if (config.catchphrases?.length) {
    const safe = config.catchphrases.map((p) => `"${s(p, LIMITS.catchphrase)}"`).join(', ');
    parts.push(`Occasionally use these signature phrases naturally (don't force them every time): ${safe}`);
  }

  if (config.signature_greeting) {
    parts.push(`When opening a show, use a greeting like: "${s(config.signature_greeting, LIMITS.greeting)}"`);
  }

  if (config.signature_signoff) {
    parts.push(`When closing a show, sign off with something like: "${s(config.signature_signoff, LIMITS.greeting)}"`);
  }

  if (config.topics_to_avoid?.length) {
    const safe = config.topics_to_avoid.map((t) => s(t, LIMITS.topic)).join(', ');
    parts.push(`NEVER discuss or reference these topics: ${safe}`);
  }

  return parts.join('\n');
}

// System prompt for the DJ persona.
// User-supplied fields (name, personality, voice_style) are sanitized to strip
// control chars / bidi codepoints / zero-width unicode. Free-form text is
// further wrapped in <untrusted> delimiters so prompt-injection payloads are
// treated by the LLM as character data, not directives.
export function buildSystemPrompt(profile: DjProfile): string {
  const safeName = s(profile.name, LIMITS.name);
  const lines: string[] = [
    `You are ${safeName}, a radio DJ. Persona description follows in the <untrusted> block:`,
    wrapUntrusted('persona.personality', profile.personality, LIMITS.personality),
    '',
    `Voice style: ${wrapUntrusted('persona.voice_style', profile.voice_style, LIMITS.voice_style)}`,
  ];

  // Add structured persona traits if present
  const config = profile.persona_config;
  if (config && Object.keys(config).length > 0) {
    lines.push('');
    lines.push('Character traits:');
    lines.push(buildPersonaSection(config));
  }

  lines.push('');
  lines.push(`Rules:
- Write ONLY the spoken script — no stage directions, no asterisks, no emojis
- Keep it natural and conversational, like you are speaking live on air
- Stay in character at all times
- Be concise: most segments should be 1-3 sentences
- Never break the fourth wall or mention that you are an AI`);

  lines.push('');
  lines.push(`VARIETY IS ESSENTIAL — every segment must feel distinct:
- NEVER open two segments with the same word or phrase (e.g. do not say "Hey" every time)
- Mix your approach: sometimes lead with a song fact, a question, an observation, a callback to the last track, a time/vibe reference, or an atmosphere-setting line — not just a greeting
- Vary sentence structure and energy between segments — punchy one moment, warm the next
- Write like a real DJ who naturally sounds different every time they open their mouth`);

  return lines.join('\n').trim();
}

// Default prompt templates per segment type
const SEGMENT_DEFAULTS: Record<DjSegmentType, string> = {
  show_intro: `Open the show for {{station_name}} on {{current_date}}. Set the mood and welcome listeners in. The very first song up is "{{next_song_title}}" by {{next_song_artist}} — you can tease it or jump straight into the vibe.`,
  song_intro: `You just played "{{prev_song_title}}" by {{prev_song_artist}}. Now set up "{{next_song_title}}" by {{next_song_artist}}. Pick ONE creative angle: a fun fact about the artist, what makes this track special, a feeling it evokes, or a sharp observation — then hand off to the song. Do NOT just say what the song is called again.`,
  song_transition: `Bridge from "{{prev_song_title}}" by {{prev_song_artist}} to "{{next_song_title}}" by {{next_song_artist}}. Comment on what you just heard, then pivot naturally to what's coming. Make it feel like one continuous conversation.`,
  show_outro: `Wrap up the show on {{station_name}}. Thank listeners genuinely, give a feel for what's next or who's on after you, and sign off with personality.`,
  station_id: `Give a live station identification for {{station_name}}{{station_id_suffix}}. Say the station name clearly and naturally — work in the callsign, frequency, or tagline if available, but keep it punchy and in-character. No more than 2 sentences.`,
  time_check: `Give a time check — it's {{current_time_local}} on {{station_name}}. Weave the time naturally into a moment: tie it to the vibe, what listeners might be doing right now, or just say it with personality. Keep it brief (1-2 sentences).`,
  weather_tease: `{{#weather}}Give a quick weather update for {{station_city}}: {{weather_summary}}. Keep it conversational and brief.{{/weather}}{{^weather}}Tease an upcoming weather update in one sentence.{{/weather}}`,
  ad_break: `Announce a short commercial break in a smooth, natural way that doesn't feel like a hard stop.`,
  adlib: `Drop a quick, spontaneous on-air comment — a shout-out, a fun fact, or a playful observation. Keep it under 2 sentences. Be natural, like you just thought of it.`,
  joke: `Tell a short {{joke_style}} joke. Keep it 1-3 lines — punchy and in-character as {{dj_name}} on {{station_name}}.{{#city}} You can optionally weave in a reference to {{city}} if it fits naturally.{{/city}} Do not explain the joke or break character after delivering it.`,
  current_events: `Briefly mention 1-2 current news headlines in a natural, conversational way on {{station_name}}. Keep it light and relatable — you're a DJ, not a newscaster. Headlines available: {{news_headlines}}`,
  listener_activity: `Give a shoutout to {{listener_name}} who sent in this message: "{{listener_message}}". Make it feel personal, warm, and on-brand for the station. Keep it to 2-3 sentences.`,
};

/** Build the station ID suffix from identity fields, e.g. " — DWRR, 97.1 FM, The Sound of Manila". */
function buildStationIdSuffix(identity?: StationIdentity | null): string {
  if (!identity) return '';
  const parts: string[] = [];
  if (identity.callsign) parts.push(identity.callsign);
  if (identity.frequency) parts.push(identity.frequency);
  if (identity.tagline) parts.push(identity.tagline);
  if (identity.city) parts.push(identity.city);
  if (parts.length === 0) return '';
  return ` — ${parts.join(', ')}`;
}

// Resolve {{#section}}...{{/section}} and {{^section}}...{{/section}} blocks
function resolveConditionals(template: string, ctx: ScriptContext): string {
  // {{#weather}}...{{/weather}} — render if weather data present
  const hasWeather = !!ctx.weather;
  template = template.replace(/\{\{#weather\}\}([\s\S]*?)\{\{\/weather\}\}/g, (_, inner) =>
    hasWeather ? inner : '',
  );
  template = template.replace(/\{\{\^weather\}\}([\s\S]*?)\{\{\/weather\}\}/g, (_, inner) =>
    hasWeather ? '' : inner,
  );

  // {{#news}}...{{/news}} — render if news items present
  const hasNews = !!(ctx.news_items && ctx.news_items.length > 0);
  template = template.replace(/\{\{#news\}\}([\s\S]*?)\{\{\/news\}\}/g, (_, inner) =>
    hasNews ? inner : '',
  );
  template = template.replace(/\{\{\^news\}\}([\s\S]*?)\{\{\/news\}\}/g, (_, inner) =>
    hasNews ? '' : inner,
  );

  return template;
}

// Simple {{variable}} interpolation
function interpolate(template: string, ctx: ScriptContext): string {
  const stationIdSuffix = buildStationIdSuffix(ctx.station_identity);
  const resolved = resolveConditionals(template, ctx);

  const newsHeadline1 = ctx.news_items?.[0]?.title ?? '';
  const newsHeadline2 = ctx.news_items?.[1]?.title ?? '';

  const city = ctx.station_identity?.city ?? '';
  const jokeStyle = ctx.joke_style ?? 'witty';

  // Handle optional city block: {{#city}}...{{/city}} — rendered only when city is present
  let result = resolved;
  if (city) {
    result = result.replace(/\{\{#city\}\}([\s\S]*?)\{\{\/city\}\}/g, '$1');
  } else {
    result = result.replace(/\{\{#city\}\}[\s\S]*?\{\{\/city\}\}/g, '');
  }

  // Every interpolated value is user-controlled (DB-stored station/song/shoutout
  // data). Sanitize each one to strip control chars / bidi smuggling payloads
  // before they reach the LLM prompt.
  return result
    .replace(/\{\{station_name\}\}/g, s(ctx.station_name, LIMITS.station_field))
    .replace(/\{\{station_city\}\}/g, s(ctx.station_city ?? ctx.station_name, LIMITS.station_field))
    .replace(/\{\{current_date\}\}/g, ctx.current_date)
    .replace(/\{\{current_hour\}\}/g, String(ctx.current_hour))
    .replace(/\{\{current_time_local\}\}/g, ctx.current_time_local ?? `${ctx.current_hour}:00`)
    .replace(/\{\{station_id_suffix\}\}/g, s(stationIdSuffix, LIMITS.station_field))
    .replace(/\{\{callsign\}\}/g, s(ctx.station_identity?.callsign, LIMITS.station_field))
    .replace(/\{\{tagline\}\}/g, s(ctx.station_identity?.tagline, LIMITS.station_field))
    .replace(/\{\{frequency\}\}/g, s(ctx.station_identity?.frequency, LIMITS.station_field))
    .replace(/\{\{city\}\}/g, s(city, LIMITS.station_field))
    .replace(/\{\{dj_name\}\}/g, s(ctx.dj_profile.name, LIMITS.name))
    .replace(/\{\{joke_style\}\}/g, s(jokeStyle, LIMITS.topic))
    .replace(/\{\{prev_song_title\}\}/g, s(ctx.prev_song?.title, LIMITS.station_field))
    .replace(/\{\{prev_song_artist\}\}/g, s(ctx.prev_song?.artist, LIMITS.station_field))
    .replace(/\{\{prev_song_album\}\}/g, s(ctx.prev_song?.album, LIMITS.station_field))
    .replace(/\{\{prev_song_year\}\}/g, ctx.prev_song?.release_year != null ? String(ctx.prev_song.release_year) : '')
    .replace(/\{\{prev_song_trivia\}\}/g, ctx.prev_song?.trivia ? s(ctx.prev_song.trivia, 500) : '')
    .replace(/\{\{next_song_title\}\}/g, s(ctx.next_song?.title, LIMITS.station_field))
    .replace(/\{\{next_song_artist\}\}/g, s(ctx.next_song?.artist, LIMITS.station_field))
    .replace(/\{\{next_song_album\}\}/g, s(ctx.next_song?.album, LIMITS.station_field))
    .replace(/\{\{next_song_year\}\}/g, ctx.next_song?.release_year != null ? String(ctx.next_song.release_year) : '')
    .replace(/\{\{next_song_trivia\}\}/g, ctx.next_song?.trivia ? s(ctx.next_song.trivia, 500) : '')
    .replace(/\{\{listener_name\}\}/g, s(ctx.shoutout?.listener_name, LIMITS.listener_name) || 'a listener')
    .replace(/\{\{listener_message\}\}/g, s(ctx.shoutout?.listener_message, LIMITS.listener_message))
    .replace(
      /\{\{news_headlines\}\}/g,
      ctx.news_headlines?.length
        ? ctx.news_headlines.map((h) => '"' + h.title + '"' + (h.source ? ' (' + h.source + ')' : '')).join('; ')
        : newsHeadline1 || 'no current headlines available',
    )
    .replace(/\{\{weather_summary\}\}/g, ctx.weather?.summary ?? '')
    .replace(/\{\{weather_temp\}\}/g, ctx.weather ? ctx.weather.temperature_c + 'C' : '')
    .replace(/\{\{weather_condition\}\}/g, ctx.weather?.condition ?? '')
    .replace(/\{\{news_headline_1\}\}/g, newsHeadline1)
    .replace(/\{\{news_headline_2\}\}/g, newsHeadline2);
}

export function buildUserPrompt(ctx: ScriptContext): string {
  // custom_template is the highest-risk field — it is free-form text supplied
  // per-station and gets interpolated into the user message. Sanitize +
  // length-cap before interpolation; the {{vars}} replacements above are
  // already individually sanitized.
  const template = ctx.custom_template
    ? sanitizeUntrusted(ctx.custom_template, LIMITS.custom_template)
    : SEGMENT_DEFAULTS[ctx.segment_type];
  let prompt = interpolate(template, ctx);

  // Append song enrichment metadata for song_intro / song_transition segments.
  // These fields are optional (broker may not be configured) and are appended
  // as context hints so the LLM can reference them naturally.
  if (ctx.segment_type === 'song_intro' || ctx.segment_type === 'song_transition') {
    const songToEnrich = ctx.next_song ?? ctx.prev_song;
    const enrichLines: string[] = [];
    if (songToEnrich?.album) enrichLines.push(`Album: ${s(songToEnrich.album, LIMITS.station_field)}`);
    if (songToEnrich?.release_year != null) enrichLines.push(`Year: ${songToEnrich.release_year}`);
    if (songToEnrich?.genres?.length) enrichLines.push(`Genres: ${songToEnrich.genres.slice(0, 3).map((g) => s(g, 50)).join(', ')}`);
    if (songToEnrich?.trivia) enrichLines.push(`Trivia (use naturally if it fits): ${songToEnrich.trivia}`);
    if (enrichLines.length > 0) {
      prompt += '\n\nSong enrichment context (from music database — work these in naturally if relevant):\n' + enrichLines.join('\n');
    }
  }

  // For joke segments, append broker joke as a seed (treated as untrusted data).
  if (ctx.segment_type === 'joke' && ctx.broker_joke) {
    const jokeText = ctx.broker_joke.setup && ctx.broker_joke.punchline
      ? `${sanitizeUntrusted(ctx.broker_joke.setup, 200)} ${sanitizeUntrusted(ctx.broker_joke.punchline, 200)}`
      : sanitizeUntrusted(ctx.broker_joke.text, 400);
    if (jokeText) {
      prompt += `\n\nJoke seed (from joke service — adapt into your own words and style, don't read it verbatim): ${wrapUntrusted('joke-api', jokeText, 400)}`;
    }
  }

  // Append the last few generated segment texts so the LLM avoids repetition.
  // Limit to 4 previous segments to keep the context window manageable.
  if (ctx.previousSegmentTexts && ctx.previousSegmentTexts.length > 0) {
    const recent = ctx.previousSegmentTexts.slice(-4);
    const list = recent.map((t, i) => (i + 1) + '. "' + t + '"').join('\n');
    prompt += '\n\nPrevious segments you already wrote (your new segment MUST open differently and feel distinct from all of these):\n' + list;
  }

  return prompt;
}
