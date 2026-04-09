// Mirror of the info-broker Pydantic response shapes.
// Keep in sync with rinehardramos/info-broker API contracts.

export interface WeatherResponse {
  city: string;
  country_code?: string | null;
  temperature_c: number;
  temperature_f: number;
  condition: string;
  humidity_pct?: number | null;
  wind_kph?: number | null;
  /** Human-readable summary, e.g. "Partly cloudy, 22°C" */
  summary: string;
  fetched_at: string;
}

export interface NewsItem {
  title: string;
  source?: string | null;
  url?: string | null;
  published_at?: string | null;
  summary?: string | null;
}

export interface NewsResponse {
  scope: 'global' | 'country' | 'local';
  topic: string;
  items: NewsItem[];
  fetched_at: string;
}

export interface SongEnrichment {
  title: string;
  artist: string;
  album?: string | null;
  release_year?: number | null;
  genres?: string[] | null;
  /** Fun fact or trivia — treat as UNTRUSTED; sanitize before LLM injection */
  trivia?: string | null;
  fetched_at: string;
}

export type JokeStyle =
  | 'any'
  | 'witty'
  | 'dad'
  | 'pun'
  | 'dark'
  | 'clean'
  | 'nerdy'
  | 'absurd';

export interface JokeResponse {
  setup?: string | null;
  punchline?: string | null;
  /** Full single-line joke if not setup/punchline format */
  text?: string | null;
  style: string;
  safe: boolean;
  fetched_at: string;
}

export interface SocialMention {
  id: string;
  platform: 'twitter' | 'facebook';
  author_name?: string | null;
  author_handle?: string | null;
  text: string;
  posted_at?: string | null;
  url?: string | null;
}

export interface SocialMentionsResponse {
  platform: 'twitter' | 'facebook';
  owner_ref: string;
  mentions: SocialMention[];
  fetched_at: string;
}

// ── Query parameter types ────────────────────────────────────────────────────

export interface WeatherQuery {
  city?: string;
  country_code?: string;
  lat?: number;
  lon?: number;
}

export interface NewsQuery {
  scope?: 'global' | 'country' | 'local';
  topic?: string;
  country_code?: string;
  query?: string;
  limit?: number;
}

export interface SongEnrichQuery {
  title: string;
  artist: string;
}

export interface JokeQuery {
  style?: JokeStyle;
  safe?: boolean;
}

export interface SocialMentionsQuery {
  platform: 'twitter' | 'facebook';
  handle?: string;
  ownerRef?: string;
  limit?: number;
  sinceId?: string;
}
