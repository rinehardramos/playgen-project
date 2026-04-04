import type { DjProfile, DjSegmentType } from '@playgen/types';

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

// System prompt for the DJ persona
export function buildSystemPrompt(profile: DjProfile): string {
  return `You are ${profile.name}, a radio DJ with the following personality: ${profile.personality}

Voice style: ${profile.voice_style}

Rules:
- Write ONLY the spoken script — no stage directions, no asterisks, no emojis
- Keep it natural and conversational, like you are speaking live on air
- Stay in character at all times
- Be concise: most segments should be 1-3 sentences
- Never break the fourth wall or mention that you are an AI`.trim();
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
