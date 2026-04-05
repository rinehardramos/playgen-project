import type { NewsHeadline } from '@playgen/types';

export interface NewsQueryOptions {
  country?: string;   // ISO 3166-1 alpha-2, e.g. "us", "ph"
  city?: string;      // optional city-level filter hint
  query?: string;     // free-text search query
  limit?: number;     // max headlines to return (default 5)
}

export interface INewsProvider {
  fetchHeadlines(options: NewsQueryOptions): Promise<NewsHeadline[]>;
}
