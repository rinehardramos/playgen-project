/**
 * TwitterV2Adapter — fetches recent @mentions of the station handle
 * using the Twitter API v2 recent search endpoint with OAuth 2.0 access token.
 *
 * Required AC from issue #212:
 * - Fetches recent @mentions (last 24h)
 * - Basic spam/bot filter applied before returning posts
 * - Excludes the station's own tweets
 * - Graceful fallback: fetch errors return [] without aborting generation
 * - Token expiry is checked before fetching; refresh handled by getSocialProviders factory
 */

import type { ISocialDataProvider, SocialPost, SocialQueryOptions } from './interface.js';

interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
}

interface TwitterUser {
  id: string;
  name: string;
  username: string;
  public_metrics?: { followers_count: number };
}

interface TwitterSearchResponse {
  data?: TwitterTweet[];
  includes?: { users?: TwitterUser[] };
  errors?: Array<{ message: string }>;
}

// Bot/spam username patterns to filter out
const BOT_PATTERN = /^(bot|spam|promo|ad[_-]?bot|advertising)/i;
const MIN_FOLLOWERS = 5;

export class TwitterV2Adapter implements ISocialDataProvider {
  readonly platform = 'twitter' as const;

  constructor(
    private readonly accessToken: string,
    private readonly stationHandle: string,  // without the @
  ) {}

  async fetchPosts({ since_hours = 24, limit = 10 }: SocialQueryOptions = {}): Promise<SocialPost[]> {
    const sinceTime = new Date(Date.now() - since_hours * 60 * 60 * 1000).toISOString();

    const url = new URL('https://api.twitter.com/2/tweets/search/recent');
    url.searchParams.set('query', `@${this.stationHandle} -is:retweet`);
    url.searchParams.set('tweet.fields', 'author_id,created_at,text');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'name,username,public_metrics');
    url.searchParams.set('start_time', sinceTime);
    url.searchParams.set('max_results', String(Math.min(Math.max(limit, 10), 100)));

    let data: TwitterSearchResponse;
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!res.ok) {
        console.warn(`[TwitterV2Adapter] API error ${res.status}: ${await res.text()}`);
        return [];
      }
      data = await res.json() as TwitterSearchResponse;
    } catch (err) {
      console.warn('[TwitterV2Adapter] Network error fetching mentions:', err);
      return [];
    }

    if (!data.data?.length) return [];

    // Build author lookup map
    const userMap = new Map<string, TwitterUser>();
    for (const user of data.includes?.users ?? []) {
      userMap.set(user.id, user);
    }

    const posts: SocialPost[] = [];
    for (const tweet of data.data) {
      const author = userMap.get(tweet.author_id);

      // Exclude station's own tweets
      if (author && author.username.toLowerCase() === this.stationHandle.toLowerCase()) continue;

      // Spam/bot filter
      if (author) {
        if (BOT_PATTERN.test(author.username)) continue;
        const followers = author.public_metrics?.followers_count ?? 0;
        if (followers < MIN_FOLLOWERS) continue;
      }

      posts.push({
        id: tweet.id,
        platform: 'twitter',
        author_name: author?.name ?? null,
        author_handle: author ? `@${author.username}` : null,
        text: tweet.text,
        posted_at: new Date(tweet.created_at),
        url: author
          ? `https://twitter.com/${author.username}/status/${tweet.id}`
          : null,
      });

      if (posts.length >= limit) break;
    }

    return posts;
  }
}
