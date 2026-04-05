/**
 * DuckDuckGo Instant Answer API — free, no key required.
 *
 * Used as a fallback when no dedicated weather_api_key / news_api_key is configured.
 * The Instant Answer API (`https://api.duckduckgo.com/?q=...&format=json`) returns
 * structured snippets, abstracts, and related topics without any authentication.
 */

import type { WeatherData, NewsItem } from './interface.js';

const DDG_BASE = 'https://api.duckduckgo.com/';

/** Derive a human-readable city name from an IANA timezone string.
 *  "Asia/Manila" → "Manila",  "America/New_York" → "New York"
 */
export function cityFromTimezone(timezone: string): string {
  const parts = timezone.split('/');
  return (parts[parts.length - 1] ?? parts[0]).replace(/_/g, ' ');
}

interface DdgResponse {
  AbstractText?: string;
  Abstract?: string;
  RelatedTopics?: Array<{
    Text?: string;
    FirstURL?: string;
    Topics?: Array<{ Text?: string; FirstURL?: string }>;
  }>;
  Answer?: string;
  AnswerType?: string;
}

async function ddgSearch(query: string): Promise<DdgResponse> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_redirect: '1',
    no_html: '1',
    skip_disambig: '1',
  });
  const res = await fetch(`${DDG_BASE}?${params}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo error ${res.status}`);
  return res.json() as Promise<DdgResponse>;
}

/**
 * Search DuckDuckGo for current weather in a city.
 * Returns a WeatherData summary or null if no useful result found.
 */
export async function ddgWeatherSearch(city: string): Promise<WeatherData | null> {
  const data = await ddgSearch(`weather in ${city} today`);

  // DuckDuckGo sometimes returns a direct answer for weather queries
  const text = data.AbstractText ?? data.Abstract ?? data.Answer ?? '';
  if (!text || text.length < 10) return null;

  // Try to extract a temperature from the text (e.g. "28°C" or "82°F")
  const celsiusMatch = text.match(/(\d+)\s*°C/i);
  const fahrenheitMatch = text.match(/(\d+)\s*°F/i);
  let tempC = 0;
  if (celsiusMatch) {
    tempC = parseInt(celsiusMatch[1], 10);
  } else if (fahrenheitMatch) {
    tempC = Math.round((parseInt(fahrenheitMatch[1], 10) - 32) * 5 / 9);
  }

  // Truncate to a reasonable summary length
  const summary = text.length > 120 ? text.slice(0, 117) + '…' : text;

  return {
    city,
    condition: 'see summary',
    temperature_c: tempC,
    humidity_pct: 0,
    wind_kph: 0,
    summary,
  };
}

/**
 * Search DuckDuckGo for top news headlines.
 * Returns up to 5 NewsItem entries extracted from RelatedTopics.
 */
export async function ddgNewsSearch(query: string): Promise<NewsItem[]> {
  const data = await ddgSearch(`latest news ${query}`);

  const items: NewsItem[] = [];

  // Flatten nested Topics (DuckDuckGo wraps topic groups)
  const flatTopics: Array<{ Text?: string; FirstURL?: string }> = [];
  for (const topic of data.RelatedTopics ?? []) {
    if (topic.Topics) {
      flatTopics.push(...topic.Topics);
    } else if (topic.Text) {
      flatTopics.push(topic);
    }
  }

  for (const topic of flatTopics) {
    if (!topic.Text) continue;
    // Extract the headline — DuckDuckGo RelatedTopics often start with the headline
    // before a dash/separator and then description
    const headline = topic.Text.split(' - ')[0]?.trim() ?? topic.Text;
    if (headline && headline.length > 10) {
      items.push({ headline, source: 'DuckDuckGo' });
    }
    if (items.length >= 5) break;
  }

  return items;
}
