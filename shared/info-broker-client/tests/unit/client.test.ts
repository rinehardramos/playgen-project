import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfoBrokerClient } from '../../src/client.js';
import type { WeatherResponse, NewsResponse, SongEnrichment, JokeResponse, SocialMentionsResponse } from '../../src/types.js';

const BASE_URL = 'http://info-broker:8000';
const API_KEY = 'test-key-123';

function makeClient(fetchFn: typeof globalThis.fetch) {
  return new InfoBrokerClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch: fetchFn });
}

function mockFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

const weatherFixture: WeatherResponse = {
  city: 'Manila',
  temperature_c: 32,
  temperature_f: 89.6,
  condition: 'Partly Cloudy',
  humidity_pct: 75,
  wind_kph: 15,
  summary: 'Partly cloudy, 32°C',
  fetched_at: '2026-04-08T00:00:00Z',
};

const newsFixture: NewsResponse = {
  scope: 'global',
  topic: 'any',
  items: [{ title: 'Headline 1', source: 'Reuters' }],
  fetched_at: '2026-04-08T00:00:00Z',
};

const songFixture: SongEnrichment = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  release_year: 1975,
  genres: ['rock', 'progressive rock'],
  trivia: 'Was recorded in multiple studios.',
  fetched_at: '2026-04-08T00:00:00Z',
};

const jokeFixture: JokeResponse = {
  setup: 'Why do programmers prefer dark mode?',
  punchline: 'Because light attracts bugs!',
  style: 'witty',
  safe: true,
  fetched_at: '2026-04-08T00:00:00Z',
};

const mentionsFixture: SocialMentionsResponse = {
  platform: 'twitter',
  owner_ref: 'station:abc',
  mentions: [{ id: '1', platform: 'twitter', text: 'Great show!', author_name: 'Listener1' }],
  fetched_at: '2026-04-08T00:00:00Z',
};

describe('InfoBrokerClient', () => {
  describe('getWeather', () => {
    it('returns WeatherResponse on 200', async () => {
      const client = makeClient(mockFetch(weatherFixture));
      const result = await client.getWeather({ city: 'Manila' });
      expect(result).toEqual(weatherFixture);
    });

    it('returns null on 500', async () => {
      const client = makeClient(mockFetch({}, 500));
      const result = await client.getWeather({ city: 'Manila' });
      expect(result).toBeNull();
    });

    it('returns null on 401 and warns', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = makeClient(mockFetch({}, 401));
      const result = await client.getWeather({ city: 'Manila' });
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('401'));
      warnSpy.mockRestore();
    });
  });

  describe('getNews', () => {
    it('returns NewsResponse on 200', async () => {
      const client = makeClient(mockFetch(newsFixture));
      const result = await client.getNews({ scope: 'global', topic: 'any' });
      expect(result).toEqual(newsFixture);
    });

    it('returns null on network error', async () => {
      const failFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const client = makeClient(failFetch as unknown as typeof fetch);
      const result = await client.getNews();
      expect(result).toBeNull();
    });
  });

  describe('enrichSong', () => {
    it('returns SongEnrichment on 200', async () => {
      const client = makeClient(mockFetch(songFixture));
      const result = await client.enrichSong({ title: 'Bohemian Rhapsody', artist: 'Queen' });
      expect(result).toEqual(songFixture);
    });
  });

  describe('getJoke', () => {
    it('returns JokeResponse on 200', async () => {
      const client = makeClient(mockFetch(jokeFixture));
      const result = await client.getJoke({ style: 'witty', safe: true });
      expect(result).toEqual(jokeFixture);
    });
  });

  describe('getSocialMentions', () => {
    it('returns SocialMentionsResponse on 200', async () => {
      const client = makeClient(mockFetch(mentionsFixture));
      const result = await client.getSocialMentions({ platform: 'twitter', ownerRef: 'station:abc' });
      expect(result).toEqual(mentionsFixture);
    });
  });

  describe('headers', () => {
    it('sends X-API-Key and User-Agent headers', async () => {
      const fetchFn = mockFetch(weatherFixture);
      const client = makeClient(fetchFn);
      await client.getWeather({ city: 'Manila' });

      const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-API-Key']).toBe(API_KEY);
      expect(headers['User-Agent']).toBe('playgen-dj/1.0');
      expect(url).toContain('/v1/weather');
    });
  });

  describe('timeout', () => {
    it('returns null on timeout', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Simulate AbortError
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const fetchFn = vi.fn().mockRejectedValue(abortError);
      const client = new InfoBrokerClient({
        baseUrl: BASE_URL,
        apiKey: API_KEY,
        timeoutMs: 1,
        fetch: fetchFn as unknown as typeof fetch,
      });
      const result = await client.getWeather({ city: 'Manila' });
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Timeout'));
      warnSpy.mockRestore();
    });
  });
});
