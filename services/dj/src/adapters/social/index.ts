/**
 * Social adapter factory.
 * Loads encrypted OAuth tokens from station_social_tokens, decrypts them,
 * refreshes stale Twitter tokens, and returns ready-to-use adapter instances.
 */

import type { Pool } from 'pg';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { config } from '../../config.js';
import type { ISocialDataProvider } from './interface.js';
import { FacebookGraphAdapter } from './facebook.js';
import { TwitterV2Adapter } from './twitter.js';

export type { ISocialDataProvider, SocialPost, SocialQueryOptions } from './interface.js';
export { FacebookGraphAdapter } from './facebook.js';
export { TwitterV2Adapter } from './twitter.js';
export { MockFacebookAdapter, MockTwitterAdapter } from './mock.js';

interface SocialTokenRow {
  id: string;
  station_id: string;
  platform: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: Date | null;
  external_account_id: string | null;
  external_account_name: string | null;
}

/** Token refresh window — refresh if within 5 minutes of expiry. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function refreshTwitterToken(
  row: SocialTokenRow,
  pool: Pool,
): Promise<string | null> {
  if (!row.refresh_token_enc) return null;

  let refreshToken: string;
  try {
    refreshToken = decrypt(row.refresh_token_enc);
  } catch {
    console.warn('[SocialAdapters] Failed to decrypt Twitter refresh token — token may be corrupt.');
    return null;
  }

  const clientId = config.social.twitterClientId;
  const clientSecret = config.social.twitterClientSecret;
  if (!clientId || !clientSecret) return null;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      console.warn(`[SocialAdapters] Twitter token refresh failed: ${res.status}`);
      return null;
    }

    const data = await res.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;

    const newExpiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    const newAccessEnc = encrypt(data.access_token);
    const newRefreshEnc = data.refresh_token ? encrypt(data.refresh_token) : row.refresh_token_enc;

    await pool.query(
      `UPDATE station_social_tokens
       SET access_token_enc = $1, refresh_token_enc = $2, expires_at = $3, updated_at = NOW()
       WHERE id = $4`,
      [newAccessEnc, newRefreshEnc, newExpiresAt, row.id],
    );

    return data.access_token;
  } catch (err) {
    console.warn('[SocialAdapters] Twitter token refresh error:', err);
    return null;
  }
}

/**
 * Load all configured social providers for a station.
 * Returns an empty array if no social tokens are configured or if
 * SOCIAL_TOKEN_ENCRYPTION_KEY is not set (encryption key missing → skip silently).
 */
export async function getSocialProviders(
  stationId: string,
  pool: Pool,
): Promise<ISocialDataProvider[]> {
  // If encryption key is absent, social fetching is disabled — non-fatal
  if (!process.env.SOCIAL_TOKEN_ENCRYPTION_KEY) return [];

  let rows: SocialTokenRow[];
  try {
    const { rows: result } = await pool.query<SocialTokenRow>(
      `SELECT sst.id, sst.station_id, sst.platform,
              sst.access_token_enc, sst.refresh_token_enc,
              sst.expires_at, sst.external_account_id, sst.external_account_name
       FROM station_social_tokens sst
       WHERE sst.station_id = $1`,
      [stationId],
    );
    rows = result;
  } catch {
    return [];
  }

  const providers: ISocialDataProvider[] = [];

  for (const row of rows) {
    try {
      if (row.platform === 'facebook') {
        const pageId = row.external_account_id;
        if (!pageId) continue;
        const accessToken = decrypt(row.access_token_enc);
        providers.push(new FacebookGraphAdapter(accessToken, pageId));

      } else if (row.platform === 'twitter') {
        // Check if Twitter token needs refresh
        let accessToken: string;
        const isExpired = row.expires_at && row.expires_at.getTime() - Date.now() < REFRESH_BUFFER_MS;
        if (isExpired) {
          const refreshed = await refreshTwitterToken(row, pool);
          if (!refreshed) continue;   // skip if refresh failed
          accessToken = refreshed;
        } else {
          accessToken = decrypt(row.access_token_enc);
        }

        // Load station's twitter_handle for filtering own tweets
        const { rows: stationRows } = await pool.query<{ twitter_handle: string | null }>(
          `SELECT twitter_handle FROM stations WHERE id = $1`,
          [stationId],
        );
        const handle = stationRows[0]?.twitter_handle ?? row.external_account_name ?? '';
        if (!handle) continue;

        providers.push(new TwitterV2Adapter(accessToken, handle.replace(/^@/, '')));
      }
    } catch (err) {
      console.warn(`[SocialAdapters] Failed to initialize ${row.platform} adapter for station ${stationId}:`, err);
    }
  }

  return providers;
}
