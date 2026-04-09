import type {
  WeatherQuery,
  WeatherResponse,
  NewsQuery,
  NewsResponse,
  SongEnrichQuery,
  SongEnrichment,
  JokeQuery,
  JokeResponse,
  SocialMentionsQuery,
  SocialMentionsResponse,
} from './types.js';

export interface InfoBrokerClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** Injectable fetch implementation for tests */
  fetch?: typeof globalThis.fetch;
}

/**
 * Typed HTTP client for the info-broker service.
 *
 * All methods are soft-fail: any network error, timeout, or non-2xx response
 * returns null and logs a warning. DJ generation MUST NOT crash because the
 * broker is unavailable.
 */
export class InfoBrokerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(opts: InfoBrokerClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    return {
      'X-API-Key': this.apiKey,
      'User-Agent': 'playgen-dj/1.0',
      'Content-Type': 'application/json',
    };
  }

  private buildUrl(path: string, params: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T | null> {
    const url = this.buildUrl(path, params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this._fetch(url, {
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 401) {
          console.warn(`[InfoBrokerClient] 401 Unauthorized — check INFO_BROKER_API_KEY`);
        } else {
          console.warn(`[InfoBrokerClient] HTTP ${res.status} for ${path}`);
        }
        return null;
      }

      return await res.json() as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn(`[InfoBrokerClient] Timeout (${this.timeoutMs}ms) for ${path}`);
      } else {
        console.warn(`[InfoBrokerClient] Network error for ${path}:`, err);
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async getWeather(q: WeatherQuery): Promise<WeatherResponse | null> {
    return this.get<WeatherResponse>('/v1/weather', {
      city: q.city,
      country_code: q.country_code,
      lat: q.lat,
      lon: q.lon,
    });
  }

  async getNews(q: NewsQuery = {}): Promise<NewsResponse | null> {
    return this.get<NewsResponse>('/v1/news', {
      scope: q.scope,
      topic: q.topic,
      country_code: q.country_code,
      query: q.query,
      limit: q.limit,
    });
  }

  async enrichSong(q: SongEnrichQuery): Promise<SongEnrichment | null> {
    return this.get<SongEnrichment>('/v1/songs/enrich', {
      title: q.title,
      artist: q.artist,
    });
  }

  async getJoke(q: JokeQuery = {}): Promise<JokeResponse | null> {
    return this.get<JokeResponse>('/v1/jokes', {
      style: q.style,
      safe: q.safe,
    });
  }

  async getSocialMentions(q: SocialMentionsQuery): Promise<SocialMentionsResponse | null> {
    return this.get<SocialMentionsResponse>('/v1/social/mentions', {
      platform: q.platform,
      handle: q.handle,
      owner_ref: q.ownerRef,
      limit: q.limit,
      since_id: q.sinceId,
    });
  }
}
