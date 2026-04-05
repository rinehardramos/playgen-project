import type { DjProfile, DjSegmentType, NewsHeadline, PersonaConfig } from '@playgen/types';
import type { WeatherData, NewsItem } from '../adapters/data/index.js';

export type { WeatherData, NewsItem };

export interface SongContext {
  title: string;
  artist: string;
  duration_sec: number | null;
}

export interface ShoutoutContext {
  listener_name: string;
  listener_message: string;
}

export interface ScriptContext {
  station_name: string;
  station_timezone: string;
  station_city?: string;
  current_date: string;    // YYYY-MM-DD
  current_hour: number;
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

// Build the structured persona section from persona_config
function buildPersonaSection(config: PersonaConfig): string {
  const parts: string[] = [];

  if (config.backstory) {
    parts.push(`Backstory: ${config.backstory}`);
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
    parts.push(`Occasionally use these signature phrases naturally (don't force them every time): ${config.catchphrases.map(p => `"${p}"`).join(', ')}`);
  }

  if (config.signature_greeting) {
    parts.push(`When opening a show, use a greeting like: "${config.signature_greeting}"`);
  }

  if (config.signature_signoff) {
    parts.push(`When closing a show, sign off with something like: "${config.signature_signoff}"`);
  }

  if (config.topics_to_avoid?.length) {
    parts.push(`NEVER discuss or reference these topics: ${config.topics_to_avoid.join(', ')}`);
  }

  return parts.join('\n');
}

// System prompt for the DJ persona
export function buildSystemPrompt(profile: DjProfile): string {
  const lines: string[] = [
    `You are ${profile.name}, a radio DJ with the following personality: ${profile.personality}`,
    '',
    `Voice style: ${profile.voice_style}`,
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
  show_intro: "Open the show for {{station_name}} on {{current_date}}. Set the mood and welcome listeners in. The very first song up is \"{{next_song_title}}\" by {{next_song_artist}} — you can tease it or jump straight into the vibe.",
  song_intro: "You just played \"{{prev_song_title}}\" by {{prev_song_artist}}. Now set up \"{{next_song_title}}\" by {{next_song_artist}}. Pick ONE creative angle: a fun fact about the artist, what makes this track special, a feeling it evokes, or a sharp observation — then hand off to the song. Do NOT just say what the song is called again.",
  song_transition: "Bridge from \"{{prev_song_title}}\" by {{prev_song_artist}} to \"{{next_song_title}}\" by {{next_song_artist}}. Comment on what you just heard, then pivot naturally to what's coming. Make it feel like one continuous conversation.",
  show_outro: "Wrap up the show on {{station_name}}. Thank listeners genuinely, give a feel for what's next or who's on after you, and sign off with personality.",
  station_id: "Give the station ID for {{station_name}} in a short, punchy line. Make it memorable — not just the name.",
  time_check: "Call out the time ({{current_hour}}:00) on {{station_name}}. Tie it to the mood, the day, or something listeners might be doing right now — don't just read the clock.",
  weather_tease: "{{#weather}}Give a quick weather update for {{station_city}}: {{weather_summary}}. Keep it conversational and brief.{{/weather}}{{^weather}}Tease an upcoming weather update in one sentence.{{/weather}}",
  ad_break: "Announce a short commercial break in a smooth, natural way that doesn't feel like a hard stop.",
  adlib: "Drop a quick, spontaneous on-air comment — a shout-out, a fun fact, or a playful observation. Keep it under 2 sentences. Be natural, like you just thought of it.",
  joke: "Tell a short, clean, family-friendly joke that fits the vibe of {{station_name}}. One setup, one punchline.",
  current_events: "{{#news}}Give a breezy, 1-2 sentence mention of what's happening in the news: \"{{news_headline_1}}\". Keep it light — no heavy politics, just conversational awareness.{{/news}}{{^news}}Briefly mention 1-2 current news headlines in a natural, conversational way on {{station_name}}. Keep it light and relatable — you're a DJ, not a newscaster. Headlines available: {{news_headlines}}{{/news}}",
  listener_activity: "Give a shoutout to {{listener_name}} who sent in this message: \"{{listener_message}}\". Make it feel personal, warm, and on-brand for the station. Keep it to 2-3 sentences.",
};

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
  const resolved = resolveConditionals(template, ctx);

  const newsHeadline1 = ctx.news_items?.[0]?.headline ?? '';
  const newsHeadline2 = ctx.news_items?.[1]?.headline ?? '';

  return resolved
    .replace(/\{\{station_name\}\}/g, ctx.station_name)
    .replace(/\{\{station_city\}\}/g, ctx.station_city ?? ctx.station_name)
    .replace(/\{\{current_date\}\}/g, ctx.current_date)
    .replace(/\{\{current_hour\}\}/g, String(ctx.current_hour))
    .replace(/\{\{prev_song_title\}\}/g, ctx.prev_song?.title ?? '')
    .replace(/\{\{prev_song_artist\}\}/g, ctx.prev_song?.artist ?? '')
    .replace(/\{\{next_song_title\}\}/g, ctx.next_song?.title ?? '')
    .replace(/\{\{next_song_artist\}\}/g, ctx.next_song?.artist ?? '')
    .replace(/\{\{listener_name\}\}/g, ctx.shoutout?.listener_name ?? 'a listener')
    .replace(/\{\{listener_message\}\}/g, ctx.shoutout?.listener_message ?? '')
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
  const template = ctx.custom_template ?? SEGMENT_DEFAULTS[ctx.segment_type];
  let prompt = interpolate(template, ctx);

  // Append the last few generated segment texts so the LLM avoids repetition.
  // Limit to 4 previous segments to keep the context window manageable.
  if (ctx.previousSegmentTexts && ctx.previousSegmentTexts.length > 0) {
    const recent = ctx.previousSegmentTexts.slice(-4);
    const list = recent.map((t, i) => (i + 1) + '. "' + t + '"').join('\n');
    prompt += '\n\nPrevious segments you already wrote (your new segment MUST open differently and feel distinct from all of these):\n' + list;
  }

  return prompt;
}
