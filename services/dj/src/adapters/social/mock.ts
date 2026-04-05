import type { ISocialDataProvider, SocialPost, SocialQueryOptions } from './interface.js';

const MOCK_FACEBOOK_POSTS: SocialPost[] = [
  {
    id: 'fb-mock-1',
    platform: 'facebook',
    author_name: 'Maria Santos',
    author_handle: null,
    text: 'Loving the morning show today! Keep up the great energy, team!',
    posted_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
    url: null,
  },
  {
    id: 'fb-mock-2',
    platform: 'facebook',
    author_name: 'Carlo Reyes',
    author_handle: null,
    text: 'This song brings back so many memories. Thank you for playing it!',
    posted_at: new Date(Date.now() - 4 * 60 * 60 * 1000),
    url: null,
  },
];

const MOCK_TWITTER_POSTS: SocialPost[] = [
  {
    id: 'tw-mock-1',
    platform: 'twitter',
    author_name: 'Juan dela Cruz',
    author_handle: '@juandc_fan',
    text: '@stationhandle You guys are the best morning radio show in town! 🎶',
    posted_at: new Date(Date.now() - 1 * 60 * 60 * 1000),
    url: null,
  },
  {
    id: 'tw-mock-2',
    platform: 'twitter',
    author_name: 'Ana Lim',
    author_handle: '@analim_music',
    text: 'Just requested my fav song on @stationhandle fingers crossed they play it! 🤞',
    posted_at: new Date(Date.now() - 3 * 60 * 60 * 1000),
    url: null,
  },
];

export class MockFacebookAdapter implements ISocialDataProvider {
  readonly platform = 'facebook' as const;

  async fetchPosts({ limit = 10 }: SocialQueryOptions = {}): Promise<SocialPost[]> {
    return MOCK_FACEBOOK_POSTS.slice(0, limit);
  }
}

export class MockTwitterAdapter implements ISocialDataProvider {
  readonly platform = 'twitter' as const;

  async fetchPosts({ limit = 10 }: SocialQueryOptions = {}): Promise<SocialPost[]> {
    return MOCK_TWITTER_POSTS.slice(0, limit);
  }
}
