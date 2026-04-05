import type { NewsHeadline } from '@playgen/types';
import type { INewsProvider, NewsQueryOptions } from './interface.js';

interface NewsApiArticle {
  title: string;
  description: string | null;
  source: { name: string } | null;
}

interface NewsApiResponse {
  status: string;
  articles?: NewsApiArticle[];
}

/**
 * NewsAPI.org adapter (https://newsapi.org).
 * Requires a free or paid API key set via station config `news_api_key`.
 */
export class NewsAPIAdapter implements INewsProvider {
  constructor(private readonly apiKey: string) {}

  async fetchHeadlines({ country = 'us', limit = 5 }: NewsQueryOptions): Promise<NewsHeadline[]> {
    const url = new URL('https://newsapi.org/v2/top-headlines');
    url.searchParams.set('country', country);
    url.searchParams.set('pageSize', String(Math.min(limit, 20)));
    url.searchParams.set('apiKey', this.apiKey);

    let res: Response;
    try {
      res = await fetch(url.toString());
    } catch (err) {
      console.warn('[NewsAPIAdapter] Network error fetching headlines:', err);
      return [];
    }

    if (!res.ok) {
      console.warn(`[NewsAPIAdapter] Non-OK response: ${res.status}`);
      return [];
    }

    let data: NewsApiResponse;
    try {
      data = await res.json() as NewsApiResponse;
    } catch {
      return [];
    }

    if (data.status !== 'ok' || !Array.isArray(data.articles)) {
      return [];
    }

    return data.articles.slice(0, limit).map((a) => ({
      title: a.title,
      description: a.description ?? undefined,
      source: a.source?.name ?? undefined,
    }));
  }
}
