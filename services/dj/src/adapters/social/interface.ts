/** A single post, comment, or mention pulled from a social platform. */
export interface SocialPost {
  id: string;               // platform-native post/comment ID
  platform: 'facebook' | 'twitter';
  author_name: string | null;   // display name (e.g. "Maria Reyes"), null if unavailable
  author_handle: string | null; // @username or page name
  text: string;             // cleaned post/comment body
  posted_at: Date;
  url: string | null;       // permalink to the post/comment, if available
}

export interface SocialQueryOptions {
  since_hours?: number;     // look-back window in hours (default: 24)
  limit?: number;           // max posts to return (default: 10)
}

/** Common contract for Facebook and Twitter social data providers. */
export interface ISocialDataProvider {
  readonly platform: 'facebook' | 'twitter';
  fetchPosts(options?: SocialQueryOptions): Promise<SocialPost[]>;
}
