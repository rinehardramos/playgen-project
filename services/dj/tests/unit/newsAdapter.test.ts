import { describe, it, expect } from 'vitest';
import { MockNewsAdapter } from '../../src/adapters/news/mock';

describe('MockNewsAdapter', () => {
  it('returns headlines', async () => {
    const adapter = new MockNewsAdapter();
    const headlines = await adapter.fetchHeadlines({});
    expect(headlines.length).toBeGreaterThan(0);
    expect(headlines[0]).toHaveProperty('title');
    expect(typeof headlines[0].title).toBe('string');
  });

  it('respects limit parameter', async () => {
    const adapter = new MockNewsAdapter();
    const headlines = await adapter.fetchHeadlines({ limit: 2 });
    expect(headlines.length).toBeLessThanOrEqual(2);
  });

  it('returns source on each headline', async () => {
    const adapter = new MockNewsAdapter();
    const headlines = await adapter.fetchHeadlines({});
    for (const h of headlines) {
      expect(h.source).toBeTruthy();
    }
  });
});
