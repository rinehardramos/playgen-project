/**
 * themeResolver.ts
 *
 * Resolves active program themes into per-segment micro-directives that are
 * easy for the LLM to execute. The intelligence lives HERE (orchestration),
 * not in the LLM prompt (which gets pre-computed actionable bullets).
 */

import type { ProgramTheme } from '@playgen/types';
import type { WeatherResponse, NewsItem } from '@playgen/info-broker-client';

// ── Public Types ─────────────────────────────────────────────────────────────

export interface SegmentDirective {
  instruction: string;
  source_theme: string;
  required: boolean;
}

export interface ThemeDirectives {
  /** Playlist-level influence (for scheduler integration — Phase 2) */
  playlist_influence: {
    energy_shift: number;       // -3 to +3
    genre_boost: string[];
    era_filter?: string[];
  };
  /** Per-segment position directives */
  segment_directives: Map<number, SegmentDirective[]>;
  /** Global context appended to EVERY segment (mood/tone guidance) */
  global_dj_context: string;
}

export interface ExternalContext {
  weather?: WeatherResponse | null;
  news_items?: NewsItem[] | null;
  total_segments?: number;
}

// ── Theme Resolution ─────────────────────────────────────────────────────────

/**
 * Main entry: resolve active themes + external data into actionable directives.
 */
export function resolveThemeDirectives(
  themes: ProgramTheme[],
  ctx: ExternalContext,
): ThemeDirectives {
  const active = themes.filter(t => t.active).sort((a, b) => b.priority - a.priority);

  if (active.length === 0) {
    return {
      playlist_influence: { energy_shift: 0, genre_boost: [] },
      segment_directives: new Map(),
      global_dj_context: '',
    };
  }

  const totalPriority = active.reduce((sum, t) => sum + t.priority, 0);
  const totalSegments = ctx.total_segments ?? 20;

  let energyShift = 0;
  const genreBoost: string[] = [];
  const eraFilter: string[] = [];
  const globalParts: string[] = [];
  const segmentMap = new Map<number, SegmentDirective[]>();

  for (const theme of active) {
    const weight = theme.priority / totalPriority;

    switch (theme.type) {
      case 'weather_reactive':
        resolveWeatherTheme(theme, ctx.weather, weight, { energyShift: (v) => energyShift += v, genreBoost, globalParts, segmentMap, totalSegments });
        break;
      case 'news_reactive':
        resolveNewsTheme(theme, ctx.news_items, { globalParts, segmentMap, totalSegments });
        break;
      case 'sponsored':
        resolveSponsoredTheme(theme, { globalParts, segmentMap, totalSegments });
        break;
      case 'custom':
        resolveCustomTheme(theme, { energyShift: (v) => energyShift += v, genreBoost, eraFilter, globalParts });
        break;
      case 'mood':
        resolveMoodTheme(theme, { energyShift: (v) => energyShift += v, globalParts });
        break;
      default:
        // event, social_driven — Phase 2
        break;
    }
  }

  return {
    playlist_influence: {
      energy_shift: Math.max(-3, Math.min(3, Math.round(energyShift))),
      genre_boost: [...new Set(genreBoost)],
      ...(eraFilter.length > 0 ? { era_filter: eraFilter } : {}),
    },
    segment_directives: segmentMap,
    global_dj_context: globalParts.join('\n'),
  };
}

/**
 * Format directives for a specific segment position into a prompt-ready string.
 */
export function formatDirectivesForSegment(
  directives: ThemeDirectives,
  position: number,
): string | undefined {
  const parts: string[] = [];

  if (directives.global_dj_context) {
    parts.push(directives.global_dj_context);
  }

  const segDirectives = directives.segment_directives.get(position);
  if (segDirectives?.length) {
    for (const d of segDirectives) {
      parts.push(`- ${d.required ? '[MUST]' : '[IF NATURAL]'} ${d.instruction}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}

// ── Theme-Specific Resolvers ─────────────────────────────────────────────────

interface ResolverContext {
  energyShift?: (delta: number) => void;
  genreBoost?: string[];
  eraFilter?: string[];
  globalParts: string[];
  segmentMap?: Map<number, SegmentDirective[]>;
  totalSegments?: number;
}

function resolveWeatherTheme(
  theme: ProgramTheme,
  weather: WeatherResponse | null | undefined,
  weight: number,
  ctx: ResolverContext,
) {
  if (!weather) return;

  const condition = (weather.condition ?? '').toLowerCase();
  const temp = weather.temperature_c;

  // Determine mood based on weather
  let mood = 'neutral';
  let shift = 0;

  if (condition.includes('rain') || condition.includes('storm') || condition.includes('typhoon')) {
    mood = 'mellow/cozy';
    shift = -2;
    if (condition.includes('typhoon')) {
      mood = 'calming/supportive';
      shift = -3;
      ctx.globalParts.push('[Weather: TYPHOON SIGNAL] Prioritize safety, calm tone, community support. Override high-energy themes.');
    } else {
      ctx.globalParts.push(`[Weather: Rainy] Mood is mellow/cozy. Reference staying dry, indoor vibes. Playlist shifted toward acoustic/chill.`);
    }
    ctx.genreBoost?.push('acoustic', 'R&B', 'lo-fi');
  } else if (condition.includes('sun') || condition.includes('clear')) {
    if (typeof temp === 'number' && temp > 32) {
      mood = 'hot/sunny';
      shift = 1;
      ctx.globalParts.push(`[Weather: Hot & Sunny (${temp}°C)] Energetic summer vibes. Reference the heat, staying cool, beach/pool.`);
    } else {
      mood = 'pleasant';
      shift = 1;
      ctx.globalParts.push(`[Weather: Nice day] Light, positive energy. Reference the good weather briefly.`);
    }
    ctx.genreBoost?.push('pop', 'dance', 'summer');
  } else if (condition.includes('cloud') || condition.includes('overcast')) {
    mood = 'introspective';
    shift = -1;
    ctx.globalParts.push(`[Weather: Cloudy/Overcast] Slightly mellow tone. Cozy indoor references work well.`);
  }

  ctx.energyShift?.(shift * weight);

  // Inject weather mention in specific segments
  const weatherSegments = [0, Math.floor((ctx.totalSegments ?? 20) / 2)];
  for (const pos of weatherSegments) {
    addDirective(ctx.segmentMap!, pos, {
      instruction: `Reference the weather naturally (${condition}, ${temp ? temp + '°C' : mood})`,
      source_theme: 'weather_reactive',
      required: false,
    });
  }
}

function resolveNewsTheme(
  theme: ProgramTheme,
  newsItems: NewsItem[] | null | undefined,
  ctx: ResolverContext,
) {
  if (!newsItems?.length) return;

  const cfg = theme.config as { max_mentions_per_hour?: number; categories?: string[]; exclude?: string[] };
  const maxMentions = cfg.max_mentions_per_hour ?? 3;
  const totalSeg = ctx.totalSegments ?? 20;

  // Distribute news mentions across the program
  const headlines = newsItems.slice(0, maxMentions);
  const interval = Math.floor(totalSeg / (maxMentions + 1));

  for (let i = 0; i < headlines.length; i++) {
    const pos = interval * (i + 1);
    const headline = headlines[i];
    const title = typeof headline === 'object' && 'title' in headline ? (headline as { title: string }).title : String(headline);
    addDirective(ctx.segmentMap!, pos, {
      instruction: `Reference this news naturally: "${title.slice(0, 100)}"`,
      source_theme: 'news_reactive',
      required: false,
    });
  }

  ctx.globalParts.push(`[News: ${headlines.length} headline(s) available] Weave news references conversationally — don't sound like a newscast.`);
}

function resolveSponsoredTheme(
  theme: ProgramTheme,
  ctx: ResolverContext,
) {
  const cfg = theme.config as {
    brand_name?: string;
    brand_voice?: string;
    tagline?: string;
    mentions_per_hour?: number;
    cta?: string;
    restrictions?: string[];
  };

  const brand = cfg.brand_name ?? 'Sponsor';
  const mentions = cfg.mentions_per_hour ?? 2;
  const totalSeg = ctx.totalSegments ?? 20;
  const interval = Math.floor(totalSeg / (mentions + 1));

  ctx.globalParts.push(
    `[Sponsored: ${brand}] Brand voice: ${cfg.brand_voice ?? 'professional'}. ` +
    `Weave mentions NATURALLY — never sound like reading an ad. ` +
    (cfg.restrictions?.length ? `Restrictions: ${cfg.restrictions.join(', ')}` : ''),
  );

  for (let i = 0; i < mentions; i++) {
    const pos = interval * (i + 1);
    const instruction = i === mentions - 1 && cfg.cta
      ? `Mention ${brand} naturally with CTA: "${cfg.cta}"`
      : `Mention ${brand} naturally (tagline: "${cfg.tagline ?? ''}")`;

    addDirective(ctx.segmentMap!, pos, {
      instruction,
      source_theme: `sponsored:${brand}`,
      required: true,
    });
  }
}

function resolveCustomTheme(
  theme: ProgramTheme,
  ctx: ResolverContext,
) {
  const cfg = theme.config as {
    theme_name?: string;
    description?: string;
    dj_directive?: string;
    playlist_filter?: { era?: string[]; genre_boost?: string[]; energy_shift?: number };
  };

  if (cfg.dj_directive) {
    ctx.globalParts.push(`[Custom Theme: ${cfg.theme_name ?? 'Custom'}] ${cfg.dj_directive}`);
  }

  if (cfg.playlist_filter?.era) {
    ctx.eraFilter?.push(...cfg.playlist_filter.era);
  }
  if (cfg.playlist_filter?.genre_boost) {
    ctx.genreBoost?.push(...cfg.playlist_filter.genre_boost);
  }
  if (cfg.playlist_filter?.energy_shift != null) {
    ctx.energyShift?.(cfg.playlist_filter.energy_shift);
  }
}

function resolveMoodTheme(
  theme: ProgramTheme,
  ctx: ResolverContext,
) {
  const cfg = theme.config as { mood?: string; energy_level?: number; description?: string };
  const mood = cfg.mood ?? 'balanced';

  const moodEnergy: Record<string, number> = {
    chill: -2, relax: -2, melancholy: -2,
    balanced: 0, focused: 0,
    energize: 2, hype: 3, party: 3,
    motivate: 1,
  };

  ctx.energyShift?.(moodEnergy[mood] ?? 0);
  ctx.globalParts.push(
    `[Mood: ${mood}] ${cfg.description ?? `Set a ${mood} tone throughout. Adapt energy and references to match.`}`,
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function addDirective(
  map: Map<number, SegmentDirective[]>,
  position: number,
  directive: SegmentDirective,
) {
  if (!map.has(position)) map.set(position, []);
  map.get(position)!.push(directive);
}
