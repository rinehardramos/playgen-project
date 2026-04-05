import type { NewsHeadline } from '@playgen/types';
import type { INewsProvider, NewsQueryOptions } from './interface.js';

const MOCK_HEADLINES: NewsHeadline[] = [
  { title: 'Local sports team wins regional championship', source: 'Local Sports' },
  { title: 'City council approves new community park expansion', source: 'City News' },
  { title: 'Weekend weather looks bright with temperatures in the mid-70s', source: 'Weather Today' },
  { title: 'New coffee shop opens downtown to rave reviews', source: 'Food & Lifestyle' },
  { title: 'Annual music festival returns next month with surprise headliner', source: 'Entertainment' },
];

/** Mock news provider for unit tests and dev environments without an API key. */
export class MockNewsAdapter implements INewsProvider {
  async fetchHeadlines({ limit = 5 }: NewsQueryOptions): Promise<NewsHeadline[]> {
    return MOCK_HEADLINES.slice(0, limit);
  }
}
