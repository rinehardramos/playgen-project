#!/usr/bin/env node
/**
 * E2E: authentication surface — login, /me, refresh, bad credentials,
 * unauthenticated access, forgot-password intake, logout.
 */
import { createRunner, finish, ADMIN_EMAIL } from './lib.mjs';

const r = createRunner('auth');
const { assert, api, setStep, setToken, getToken } = r;

async function main() {
  setStep(1, 'reject bad credentials');
  const bad = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: 'definitely-wrong-password' },
  });
  assert(bad.status === 401 || bad.status === 400, 'wrong password is rejected', bad);

  setStep(2, 'login');
  const { user, tokens } = await r.login(undefined, undefined, { fresh: true });
  assert(!!user?.id, 'login returns the user');
  assert(!!user?.company_id, 'login returns company_id');
  assert(!!tokens?.refresh_token, 'login returns a refresh token');

  setStep(3, 'authenticated identity');
  const me = await api('/api/v1/me');
  assert(me.status === 200, 'GET /me returns 200', me);
  assert(me.data?.email === ADMIN_EMAIL || me.data?.user?.email === ADMIN_EMAIL, '/me returns the logged-in user', me.data);

  setStep(4, 'unauthenticated access is rejected');
  const savedToken = getToken();
  setToken('');
  const anon = await api('/api/v1/me');
  assert(anon.status === 401, 'GET /me without a token returns 401', anon);
  setToken(savedToken);

  setStep(5, 'garbage token is rejected');
  setToken('not-a-real-jwt');
  const forged = await api('/api/v1/me');
  assert(forged.status === 401, 'GET /me with a forged token returns 401', forged);
  setToken(savedToken);

  setStep(6, 'token refresh');
  const refreshed = await api('/api/v1/auth/refresh', {
    method: 'POST',
    body: { refresh_token: tokens.refresh_token },
    auth: false,
  });
  assert(refreshed.status === 200, 'POST /auth/refresh returns 200', refreshed);
  const newAccess = refreshed.data?.tokens?.access_token ?? refreshed.data?.access_token;
  assert(!!newAccess, 'refresh returns a new access token', refreshed.data);
  setToken(newAccess);
  const meAgain = await api('/api/v1/me');
  assert(meAgain.status === 200, 'refreshed token works against /me', meAgain);
  // Refresh may rotate the refresh token — use the latest one from here on.
  const liveRefresh = refreshed.data?.tokens?.refresh_token ?? tokens.refresh_token;

  setStep(7, 'forgot-password intake');
  const forgot = await api('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: { email: ADMIN_EMAIL },
    auth: false,
  });
  assert(forgot.status >= 200 && forgot.status < 300, 'forgot-password accepts a known email', forgot);
  // Must not leak whether an email exists
  const forgotUnknown = await api('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: { email: `nobody-${Date.now()}@playgen.local` },
    auth: false,
  });
  assert(forgotUnknown.status >= 200 && forgotUnknown.status < 300, 'forgot-password does not reveal unknown emails', forgotUnknown);

  setStep(8, 'logout revokes the refresh token');
  const out = await api('/api/v1/auth/logout', {
    method: 'POST',
    body: { refresh_token: liveRefresh },
  });
  assert(out.status >= 200 && out.status < 300, 'POST /auth/logout succeeds', out);
  const reuse = await api('/api/v1/auth/refresh', {
    method: 'POST',
    body: { refresh_token: liveRefresh },
    auth: false,
  });
  assert(reuse.status === 401 || reuse.status === 400, 'revoked refresh token is rejected', reuse);

  finish('auth');
}

main().catch(err => { console.error('\n✗ FAIL [auth] unhandled error'); console.error(err); process.exit(1); });
