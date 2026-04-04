import type { DjProfile, DjSegmentType, PersonaConfig } from '@playgen/types';

export interface SongContext {
  title: string;
  artist: string;
  duration_sec: number | null;
}

export interface ScriptContext {
  station_name: string;
  station_timezone: string;
  current_date: string;    // YYYY-MM-DD
  current_hour: number;
  dj_profile: DjProfile;
  prev_song?: SongContext;
  next_song?: SongContext;
  segment_type: DjSegmentType;
  custom_template?: string;  // overrides default prompt when set
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

  return lines.join('\n').trim();
}

// Default prompt templates per segment type
const SEGMENT_DEFAULTS: Record<DjSegmentType, string> = {
  show_intro: `Open the show for {{station_name}} on {{current_date}}. Set the mood and welcome listeners.`,
  song_intro: `Introduce "{{next_song_title}}" by {{next_song_artist}}. Keep it short and hype it up.`,
  song_transition: `Bridge from "{{prev_song_title}}" by {{prev_song_artist}} to "{{next_song_title}}" by {{next_song_artist}}. Make it feel seamless.`,
  show_outro: `Close out the show on {{station_name}}. Thank listeners and tease what's coming up.`,
  station_id: `Give the station ID for {{station_name}} in a short, punchy line.`,
  time_check: `Call out the time — it's {{current_hour}}:00 — on {{station_name}}.`,
  weather_tease: `Tease an upcoming weather update in one sentence.`,
  ad_break: `Announce a short commercial break in a smooth, non-intrusive way.`,
};

// Simple {{variable}} interpolation
function interpolate(template: string, ctx: ScriptContext): string {
  return template
    .replace(/\{\{station_name\}\}/g, ctx.station_name)
    .replace(/\{\{current_date\}\}/g, ctx.current_date)
    .replace(/\{\{current_hour\}\}/g, String(ctx.current_hour))
    .replace(/\{\{prev_song_title\}\}/g, ctx.prev_song?.title ?? '')
    .replace(/\{\{prev_song_artist\}\}/g, ctx.prev_song?.artist ?? '')
    .replace(/\{\{next_song_title\}\}/g, ctx.next_song?.title ?? '')
    .replace(/\{\{next_song_artist\}\}/g, ctx.next_song?.artist ?? '');
}

export function buildUserPrompt(ctx: ScriptContext): string {
  const template = ctx.custom_template ?? SEGMENT_DEFAULTS[ctx.segment_type];
  return interpolate(template, ctx);
}
