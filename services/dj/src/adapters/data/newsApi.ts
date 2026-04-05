import type { IDataProvider, NewsItem, NewsProviderConfig } from './interface.js';

const BASE_URL = 'https://newsapi.org/v2/top-headlines';

export const newsApiProvider: IDataProvider<NewsProviderConfig, NewsItem[]> = {
  isConfigured(cfg) {
    return !!cfg.api_key;
  },

  async fetch(cfg) {
    const params = new URLSearchParams({ apiKey: cfg.api_key, pageSize: '5' });
    if (cfg.country_code) params.set('country', cfg.country_code.toLowerCase());
    if (cfg.query) params.set('q', cfg.query);

    const res = await fetch(`${BASE_URL}?${params}`);
    if (!res.ok) {
      throw new Error(`NewsAPI error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as {
      articles: Array<{ title: string; source: { name: string } }>;
    };

    return data.articles
      .filter((a) => a.title && a.title !== '[Removed]')
      .slice(0, 5)
      .map((a) => ({ headline: a.title, source: a.source?.name }));
  },
};
