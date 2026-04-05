export type { INewsProvider, NewsQueryOptions } from './interface.js';
export { NewsAPIAdapter } from './newsapi.js';
export { MockNewsAdapter } from './mock.js';

import type { INewsProvider } from './interface.js';
import { NewsAPIAdapter } from './newsapi.js';
import { MockNewsAdapter } from './mock.js';

export function getNewsProvider(apiKey: string | null | undefined): INewsProvider {
  if (apiKey) return new NewsAPIAdapter(apiKey);
  return new MockNewsAdapter();
}
