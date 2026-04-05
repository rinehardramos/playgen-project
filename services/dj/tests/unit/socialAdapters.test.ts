import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockFacebookAdapter, MockTwitterAdapter } from '../../src/adapters/social/mock';
import { FacebookGraphAdapter } from '../../src/adapters/social/facebook';
import { TwitterV2Adapter } from '../../src/adapters/social/twitter';

// ─── Mock adapters ────────────────────────────────────────────────────────────

describe('MockFacebookAdapter', () => {
  it('returns posts', async () => {
    const adapter = new MockFacebookAdapter();
    const posts = await adapter.fetchPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].platform).toBe('facebook');
  });

  it('respects limit', async () => {
    const adapter = new MockFacebookAdapter();
    const posts = await adapter.fetchPosts({ limit: 1 });
    expect(posts.length).toBeLessThanOrEqual(1);
  });
});

describe('MockTwitterAdapter', () => {
  it('returns posts', async () => {
    const adapter = new MockTwitterAdapter();
    const posts = await adapter.fetchPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].platform).toBe('twitter');
  });

  it('returns author_handle with @ prefix', async () => {
    const adapter = new MockTwitterAdapter();
    const posts = await adapter.fetchPosts();
    for (const p of posts) {
      if (p.author_handle) expect(p.author_handle).toMatch(/^@/);
    }
  });
});

// ─── FacebookGraphAdapter ─────────────────────────────────────────────────────

describe('FacebookGraphAdapter', () => {
  const mockFetch = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', mockFetch); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('fetches posts and maps to SocialPost format', async () => {
    const mockPosts = {
      data: [{
        id: 'post-1',
        message: 'Great morning show today! Really enjoying the music.',
        created_time: new Date(Date.now() - 3600000).toISOString(),
        permalink_url: 'https://fb.com/post/1',
      }],
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockPosts })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

    const adapter = new FacebookGraphAdapter('test-token', 'test-page-id');
    const posts = await adapter.fetchPosts({ since_hours: 24, limit: 10 });
    expect(posts).toHaveLength(1);
    expect(posts[0].platform).toBe('facebook');
    expect(posts[0].text).toBe('Great morning show today! Really enjoying the music.');
    expect(posts[0].url).toBe('https://fb.com/post/1');
  });

  it('skips posts with message shorter than 10 chars', async () => {
    const mockPosts = {
      data: [
        { id: 'post-1', message: 'Short', created_time: new Date().toISOString() },
        { id: 'post-2', message: 'Long enough message to pass the minimum length filter', created_time: new Date().toISOString() },
      ],
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockPosts })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

    const adapter = new FacebookGraphAdapter('token', 'page-id');
    const posts = await adapter.fetchPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('post-2');
  });

  it('returns empty array on network error (graceful fallback)', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const adapter = new FacebookGraphAdapter('token', 'page-id');
    const posts = await adapter.fetchPosts();
    expect(posts).toHaveLength(0);
  });

  it('includes comments from recent posts', async () => {
    const mockPosts = {
      data: [{ id: 'post-1', message: 'Loving the music today on the station!', created_time: new Date().toISOString() }],
    };
    const mockComments = {
      data: [{ id: 'comment-1', message: 'Best radio show ever!', from: { name: 'Maria', id: 'user-1' }, created_time: new Date().toISOString() }],
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockPosts })
      .mockResolvedValueOnce({ ok: true, json: async () => mockComments });

    const adapter = new FacebookGraphAdapter('token', 'page-id');
    const posts = await adapter.fetchPosts();
    expect(posts.length).toBe(2);
    const comment = posts.find((p) => p.id === 'comment-1');
    expect(comment?.author_name).toBe('Maria');
  });

  it('calls Graph API with correct URL params', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    const adapter = new FacebookGraphAdapter('my-token', 'my-page');
    await adapter.fetchPosts({ since_hours: 24, limit: 5 });
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('my-page/posts'));
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('access_token=my-token'));
  });
});

// ─── TwitterV2Adapter ─────────────────────────────────────────────────────────

describe('TwitterV2Adapter', () => {
  const mockFetch = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', mockFetch); });
  afterEach(() => { vi.restoreAllMocks(); });

  function makeTweetResponse(
    tweets: Array<{ id: string; text: string; author_id: string; created_at: string }>,
    users: Array<{ id: string; name: string; username: string; public_metrics?: { followers_count: number } }>,
  ) {
    return { data: tweets, includes: { users } };
  }

  it('fetches mentions and maps to SocialPost format', async () => {
    const response = makeTweetResponse(
      [{ id: 'tweet-1', text: '@station Great show!', author_id: 'user-1', created_at: new Date().toISOString() }],
      [{ id: 'user-1', name: 'Juan', username: 'juanfan', public_metrics: { followers_count: 100 } }],
    );
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => response });

    const adapter = new TwitterV2Adapter('access-token', 'station');
    const posts = await adapter.fetchPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].platform).toBe('twitter');
    expect(posts[0].author_handle).toBe('@juanfan');
    expect(posts[0].author_name).toBe('Juan');
  });

  it('filters out bot-pattern usernames', async () => {
    const response = makeTweetResponse(
      [
        { id: 'tweet-1', text: 'Real listener tweet', author_id: 'user-1', created_at: new Date().toISOString() },
        { id: 'tweet-2', text: 'Bot spam content', author_id: 'bot-1', created_at: new Date().toISOString() },
      ],
      [
        { id: 'user-1', name: 'Real User', username: 'realuser', public_metrics: { followers_count: 50 } },
        { id: 'bot-1', name: 'Bot Account', username: 'botspammer', public_metrics: { followers_count: 50 } },
      ],
    );
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => response });

    const adapter = new TwitterV2Adapter('token', 'station');
    const posts = await adapter.fetchPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('tweet-1');
  });

  it('excludes station own tweets', async () => {
    const response = makeTweetResponse(
      [{ id: 'tweet-1', text: '@station RT this!', author_id: 'station-user', created_at: new Date().toISOString() }],
      [{ id: 'station-user', name: 'Radio Station', username: 'MyStation', public_metrics: { followers_count: 5000 } }],
    );
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => response });

    const adapter = new TwitterV2Adapter('token', 'MyStation');
    const posts = await adapter.fetchPosts();
    expect(posts).toHaveLength(0);
  });

  it('filters accounts with fewer than 5 followers', async () => {
    const response = makeTweetResponse(
      [{ id: 'tweet-1', text: 'Great station!', author_id: 'user-1', created_at: new Date().toISOString() }],
      [{ id: 'user-1', name: 'New User', username: 'newuser', public_metrics: { followers_count: 2 } }],
    );
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => response });

    const adapter = new TwitterV2Adapter('token', 'station');
    const posts = await adapter.fetchPosts();
    expect(posts).toHaveLength(0);
  });

  it('returns empty array on network error (graceful fallback)', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));
    const adapter = new TwitterV2Adapter('token', 'station');
    const posts = await adapter.fetchPosts();
    expect(posts).toHaveLength(0);
  });

  it('sends Bearer auth header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    const adapter = new TwitterV2Adapter('my-access-token', 'station');
    await adapter.fetchPosts();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer my-access-token' }) }),
    );
  });
});
