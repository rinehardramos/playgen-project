/**
 * FacebookGraphAdapter — fetches recent posts and top comments from a Facebook Page
 * using the Graph API v20.0 with a long-lived Page access token.
 *
 * Required AC from issue #211:
 * - Fetches recent page posts + comments (last 24h)
 * - Maps to SocialPost format for listener_activity segment generation
 * - Graceful fallback: fetch errors return [] without aborting generation
 */

import type { ISocialDataProvider, SocialPost, SocialQueryOptions } from './interface.js';

interface GraphPostFields {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
}

interface GraphCommentFields {
  id: string;
  message?: string;
  from?: { name: string; id: string };
  created_time: string;
}

interface GraphResponse<T> {
  data: T[];
  error?: { message: string; code: number };
}

const GRAPH_BASE = 'https://graph.facebook.com/v20.0';
const MIN_TEXT_LENGTH = 10;

export class FacebookGraphAdapter implements ISocialDataProvider {
  readonly platform = 'facebook' as const;

  constructor(
    private readonly pageAccessToken: string,
    private readonly pageId: string,
  ) {}

  async fetchPosts({ since_hours = 24, limit = 10 }: SocialQueryOptions = {}): Promise<SocialPost[]> {
    const since = Math.floor((Date.now() - since_hours * 60 * 60 * 1000) / 1000);
    const posts: SocialPost[] = [];

    // 1. Fetch recent page posts
    let pagePosts: GraphPostFields[] = [];
    try {
      const url = new URL(`${GRAPH_BASE}/${this.pageId}/posts`);
      url.searchParams.set('fields', 'id,message,created_time,permalink_url');
      url.searchParams.set('since', String(since));
      url.searchParams.set('limit', String(Math.min(limit, 25)));
      url.searchParams.set('access_token', this.pageAccessToken);

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json() as GraphResponse<GraphPostFields>;
        if (!data.error) pagePosts = data.data ?? [];
      }
    } catch (err) {
      console.warn('[FacebookGraphAdapter] Failed to fetch page posts:', err);
    }

    // Map posts → SocialPost (skip posts with no/short message)
    for (const post of pagePosts) {
      if (!post.message || post.message.length < MIN_TEXT_LENGTH) continue;
      posts.push({
        id: post.id,
        platform: 'facebook',
        author_name: null,                    // page post author is the station itself
        author_handle: null,
        text: post.message,
        posted_at: new Date(post.created_time),
        url: post.permalink_url ?? null,
      });
    }

    // 2. Fetch comments on each post (top 3 per post, max 5 posts sampled)
    const postsToSample = pagePosts.slice(0, 5);
    for (const post of postsToSample) {
      if (posts.length >= limit) break;
      try {
        const url = new URL(`${GRAPH_BASE}/${post.id}/comments`);
        url.searchParams.set('fields', 'id,message,from,created_time');
        url.searchParams.set('limit', '3');
        url.searchParams.set('access_token', this.pageAccessToken);

        const res = await fetch(url.toString());
        if (!res.ok) continue;
        const data = await res.json() as GraphResponse<GraphCommentFields>;
        if (data.error) continue;

        for (const comment of data.data ?? []) {
          if (!comment.message || comment.message.length < MIN_TEXT_LENGTH) continue;
          posts.push({
            id: comment.id,
            platform: 'facebook',
            author_name: comment.from?.name ?? null,
            author_handle: null,
            text: comment.message,
            posted_at: new Date(comment.created_time),
            url: null,
          });
          if (posts.length >= limit) break;
        }
      } catch {
        // Non-fatal: skip this post's comments
      }
    }

    return posts.sort((a, b) => b.posted_at.getTime() - a.posted_at.getTime()).slice(0, limit);
  }
}
