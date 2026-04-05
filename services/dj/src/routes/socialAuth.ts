/**
 * Social OAuth routes for Facebook (issue #211) and Twitter/X (issue #212).
 *
 * Facebook flow  : GET /dj/social/facebook/connect → FB OAuth dialog → GET /dj/social/facebook/callback
 * Twitter flow   : GET /dj/social/twitter/connect  → Twitter PKCE   → GET /dj/social/twitter/callback
 * Status endpoint: GET /dj/social/status?station_id=<uuid>
 * Disconnect     : POST /dj/social/:platform/disconnect { station_id }
 *
 * State tokens (CSRF protection) are stored in social_oauth_states with a 10-min TTL.
 * Twitter uses PKCE (S256) — code_verifier stored alongside the state row.
 */

import type { FastifyInstance } from 'fastify';
import { randomBytes, createHash } from 'node:crypto';
import { authenticate } from '@playgen/middleware';
import { getPool } from '../db.js';
import { config } from '../config.js';
import { encrypt } from '../lib/crypto.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateStateToken(): string {
  return randomBytes(32).toString('hex');
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function storeState(
  stationId: string,
  userId: string,
  platform: string,
  codeVerifier?: string,
): Promise<string> {
  const state = generateStateToken();
  const pool = getPool();
  await pool.query(
    `INSERT INTO social_oauth_states (state_token, station_id, platform, user_id, code_verifier)
     VALUES ($1, $2, $3, $4, $5)`,
    [state, stationId, platform, userId, codeVerifier ?? null],
  );
  // Prune expired rows opportunistically
  await pool.query(`DELETE FROM social_oauth_states WHERE expires_at < NOW()`).catch(() => null);
  return state;
}

interface StateRow {
  station_id: string;
  platform: string;
  user_id: string;
  code_verifier: string | null;
}

async function consumeState(state: string, platform: string): Promise<StateRow | null> {
  const pool = getPool();
  const { rows } = await pool.query<StateRow>(
    `DELETE FROM social_oauth_states
     WHERE state_token = $1 AND platform = $2 AND expires_at > NOW()
     RETURNING station_id, platform, user_id, code_verifier`,
    [state, platform],
  );
  return rows[0] ?? null;
}


// ─── Tenant ownership check ───────────────────────────────────────────────────

/**
 * Verify that station_id belongs to the requesting user's company.
 * Returns null on success, or a Fastify reply shorthand (throw immediately) on failure.
 */
async function assertStationOwner(
  stationId: string,
  userCompanyId: string,
  pool: ReturnType<typeof getPool>,
): Promise<boolean> {
  const { rows } = await pool.query<{ company_id: string }>(
    `SELECT company_id FROM stations WHERE id = $1`,
    [stationId],
  );
  return rows[0]?.company_id === userCompanyId;
}

// ─── Main route plugin ────────────────────────────────────────────────────────

export async function socialAuthRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // ── Social connection status ──────────────────────────────────────────────

  app.get<{ Querystring: { station_id: string } }>(
    '/dj/social/status',
    async (req, reply) => {
      const { station_id } = req.query;
      if (!station_id) return reply.badRequest('station_id is required');

      const user = (req as any).user;
      const pool = getPool();
      if (!await assertStationOwner(station_id, user.cid, pool)) {
        return reply.forbidden('Access denied to this station');
      }
      const { rows } = await pool.query<{
        platform: string;
        external_account_name: string | null;
        connected_at: string;
      }>(
        `SELECT platform, external_account_name, connected_at
         FROM station_social_tokens WHERE station_id = $1`,
        [station_id],
      );

      const statusMap: Record<string, { connected: boolean; account_name: string | null; connected_at: string | null }> = {
        facebook: { connected: false, account_name: null, connected_at: null },
        twitter:  { connected: false, account_name: null, connected_at: null },
      };
      for (const row of rows) {
        statusMap[row.platform] = {
          connected: true,
          account_name: row.external_account_name,
          connected_at: row.connected_at,
        };
      }
      return statusMap;
    },
  );

  // ── Disconnect ────────────────────────────────────────────────────────────

  app.post<{ Body: { station_id: string }; Params: { platform: string } }>(
    '/dj/social/:platform/disconnect',
    async (req, reply) => {
      const { platform } = req.params;
      const { station_id } = req.body ?? {};
      if (!station_id) return reply.badRequest('station_id is required');
      if (!['facebook', 'twitter'].includes(platform)) return reply.badRequest('Invalid platform');

      const disconnUser = (req as any).user;
      const disconnPool = getPool();
      if (!await assertStationOwner(station_id, disconnUser.cid, disconnPool)) {
        return reply.forbidden('Access denied to this station');
      }
      await disconnPool.query(
        `DELETE FROM station_social_tokens WHERE station_id = $1 AND platform = $2`,
        [station_id, platform],
      );
      return { success: true };
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Facebook OAuth
  // ─────────────────────────────────────────────────────────────────────────

  app.get<{ Querystring: { station_id: string } }>(
    '/dj/social/facebook/connect',
    async (req, reply) => {
      const { station_id } = req.query;
      if (!station_id) return reply.badRequest('station_id is required');

      const appId = config.social.facebookAppId;
      if (!appId) return reply.internalServerError('FACEBOOK_APP_ID is not configured');

      const user = (req as any).user;
      if (!await assertStationOwner(station_id, user.cid, getPool())) {
        return reply.forbidden('Access denied to this station');
      }
      const state = await storeState(station_id, user.sub, 'facebook');

      const redirectUri = `${config.social.callbackBaseUrl}/dj/social/facebook/callback`;
      const fbUrl = new URL('https://www.facebook.com/v20.0/dialog/oauth');
      fbUrl.searchParams.set('client_id', appId);
      fbUrl.searchParams.set('redirect_uri', redirectUri);
      fbUrl.searchParams.set('state', state);
      fbUrl.searchParams.set('scope', 'pages_read_engagement,pages_read_user_content,pages_show_list');

      return reply.redirect(fbUrl.toString());
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/dj/social/facebook/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      const frontendBase = config.social.frontendBaseUrl;

      if (error || !code || !state) {
        return reply.redirect(`${frontendBase}/stations?social=facebook&status=error&reason=${encodeURIComponent(error ?? 'cancelled')}`);
      }

      const stateRow = await consumeState(state, 'facebook');
      if (!stateRow) {
        return reply.redirect(`${frontendBase}/stations?social=facebook&status=error&reason=invalid_state`);
      }

      const { station_id, user_id } = stateRow;
      const appId = config.social.facebookAppId;
      const appSecret = config.social.facebookAppSecret;
      const redirectUri = `${config.social.callbackBaseUrl}/dj/social/facebook/callback`;

      try {
        // Step 1: Exchange code for short-lived user access token
        const tokenUrl = new URL('https://graph.facebook.com/v20.0/oauth/access_token');
        tokenUrl.searchParams.set('client_id', appId);
        tokenUrl.searchParams.set('redirect_uri', redirectUri);
        tokenUrl.searchParams.set('client_secret', appSecret);
        tokenUrl.searchParams.set('code', code);

        const tokenRes = await fetch(tokenUrl.toString());
        if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
        const tokenData = await tokenRes.json() as { access_token?: string; error?: { message: string } };
        if (!tokenData.access_token) throw new Error(tokenData.error?.message ?? 'No access_token returned');
        const shortLivedToken = tokenData.access_token;

        // Step 2: Exchange for long-lived user token
        const longTokenUrl = new URL('https://graph.facebook.com/v20.0/oauth/access_token');
        longTokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
        longTokenUrl.searchParams.set('client_id', appId);
        longTokenUrl.searchParams.set('client_secret', appSecret);
        longTokenUrl.searchParams.set('fb_exchange_token', shortLivedToken);

        const longTokenRes = await fetch(longTokenUrl.toString());
        if (!longTokenRes.ok) throw new Error(`Long token exchange failed: ${longTokenRes.status}`);
        const longTokenData = await longTokenRes.json() as { access_token?: string };
        const longLivedUserToken = longTokenData.access_token ?? shortLivedToken;

        // Step 3: Fetch the Page access token from the user's pages
        const pagesUrl = new URL('https://graph.facebook.com/v20.0/me/accounts');
        pagesUrl.searchParams.set('access_token', longLivedUserToken);
        pagesUrl.searchParams.set('fields', 'id,name,access_token');

        const pagesRes = await fetch(pagesUrl.toString());
        if (!pagesRes.ok) throw new Error(`Pages fetch failed: ${pagesRes.status}`);
        const pagesData = await pagesRes.json() as {
          data?: Array<{ id: string; name: string; access_token: string }>;
        };

        // Match by facebook_page_id stored on the station, or use first available page
        const pool = getPool();
        const { rows: stationRows } = await pool.query<{ facebook_page_id: string | null }>(
          `SELECT facebook_page_id FROM stations WHERE id = $1`,
          [station_id],
        );
        const configuredPageId = stationRows[0]?.facebook_page_id;
        const pages = pagesData.data ?? [];
        const page = configuredPageId
          ? (pages.find((p) => p.id === configuredPageId) ?? pages[0])
          : pages[0];

        if (!page) throw new Error('No Facebook Pages found for this account');

        // Store encrypted page access token
        const encryptedToken = encrypt(page.access_token);
        await pool.query(
          `INSERT INTO station_social_tokens
             (station_id, platform, access_token_enc, external_account_id, external_account_name, connected_by)
           VALUES ($1, 'facebook', $2, $3, $4, $5)
           ON CONFLICT (station_id, platform) DO UPDATE
             SET access_token_enc = EXCLUDED.access_token_enc,
                 external_account_id = EXCLUDED.external_account_id,
                 external_account_name = EXCLUDED.external_account_name,
                 connected_by = EXCLUDED.connected_by,
                 updated_at = NOW()`,
          [station_id, encryptedToken, page.id, page.name, user_id],
        );

        return reply.redirect(
          `${frontendBase}/stations/${station_id}/settings?social=facebook&status=connected`,
        );
      } catch (err) {
        console.error('[socialAuth] Facebook callback error:', err);
        return reply.redirect(
          `${frontendBase}/stations/${station_id}/settings?social=facebook&status=error`,
        );
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Twitter/X OAuth 2.0 PKCE
  // ─────────────────────────────────────────────────────────────────────────

  app.get<{ Querystring: { station_id: string } }>(
    '/dj/social/twitter/connect',
    async (req, reply) => {
      const { station_id } = req.query;
      if (!station_id) return reply.badRequest('station_id is required');

      const clientId = config.social.twitterClientId;
      if (!clientId) return reply.internalServerError('TWITTER_CLIENT_ID is not configured');

      const user = (req as any).user;
      if (!await assertStationOwner(station_id, user.cid, getPool())) {
        return reply.forbidden('Access denied to this station');
      }
      const verifier = generateCodeVerifier();
      const challenge = codeChallenge(verifier);
      const state = await storeState(station_id, user.sub, 'twitter', verifier);

      const redirectUri = `${config.social.callbackBaseUrl}/dj/social/twitter/callback`;
      const twitterUrl = new URL('https://twitter.com/i/oauth2/authorize');
      twitterUrl.searchParams.set('response_type', 'code');
      twitterUrl.searchParams.set('client_id', clientId);
      twitterUrl.searchParams.set('redirect_uri', redirectUri);
      twitterUrl.searchParams.set('scope', 'tweet.read users.read offline.access');
      twitterUrl.searchParams.set('state', state);
      twitterUrl.searchParams.set('code_challenge', challenge);
      twitterUrl.searchParams.set('code_challenge_method', 'S256');

      return reply.redirect(twitterUrl.toString());
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/dj/social/twitter/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      const frontendBase = config.social.frontendBaseUrl;

      if (error || !code || !state) {
        return reply.redirect(`${frontendBase}/stations?social=twitter&status=error&reason=${encodeURIComponent(error ?? 'cancelled')}`);
      }

      const stateRow = await consumeState(state, 'twitter');
      if (!stateRow) {
        return reply.redirect(`${frontendBase}/stations?social=twitter&status=error&reason=invalid_state`);
      }

      const { station_id, user_id, code_verifier } = stateRow;
      if (!code_verifier) {
        return reply.redirect(`${frontendBase}/stations/${station_id}/settings?social=twitter&status=error`);
      }

      const clientId = config.social.twitterClientId;
      const clientSecret = config.social.twitterClientSecret;
      const redirectUri = `${config.social.callbackBaseUrl}/dj/social/twitter/callback`;

      try {
        // Exchange code + code_verifier for tokens
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const body = new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: redirectUri,
          code_verifier,
        });

        const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
          },
          body: body.toString(),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          throw new Error(`Token exchange failed (${tokenRes.status}): ${errText}`);
        }

        const tokenData = await tokenRes.json() as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };
        if (!tokenData.access_token) throw new Error('No access_token in response');

        // Fetch authenticated user info for display + filtering
        const meRes = await fetch('https://api.twitter.com/2/users/me?user.fields=name,username', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const meData = meRes.ok
          ? await meRes.json() as { data?: { id: string; name: string; username: string } }
          : null;
        const twitterUser = meData?.data;

        const expiresAt = tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null;

        const pool = getPool();
        await pool.query(
          `INSERT INTO station_social_tokens
             (station_id, platform, access_token_enc, refresh_token_enc, expires_at,
              external_account_id, external_account_name, connected_by)
           VALUES ($1, 'twitter', $2, $3, $4, $5, $6, $7)
           ON CONFLICT (station_id, platform) DO UPDATE
             SET access_token_enc = EXCLUDED.access_token_enc,
                 refresh_token_enc = EXCLUDED.refresh_token_enc,
                 expires_at = EXCLUDED.expires_at,
                 external_account_id = EXCLUDED.external_account_id,
                 external_account_name = EXCLUDED.external_account_name,
                 connected_by = EXCLUDED.connected_by,
                 updated_at = NOW()`,
          [
            station_id,
            encrypt(tokenData.access_token),
            tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
            expiresAt,
            twitterUser?.id ?? null,
            twitterUser ? `@${twitterUser.username}` : null,
            user_id,
          ],
        );

        return reply.redirect(
          `${frontendBase}/stations/${station_id}/settings?social=twitter&status=connected`,
        );
      } catch (err) {
        console.error('[socialAuth] Twitter callback error:', err);
        return reply.redirect(
          `${frontendBase}/stations/${station_id}/settings?social=twitter&status=error`,
        );
      }
    },
  );
}
