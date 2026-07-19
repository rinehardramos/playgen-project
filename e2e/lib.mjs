/**
 * Shared helpers for the e2e journey scripts.
 *
 * Same conventions as programs-journey.mjs: plain Node (global fetch), zero
 * install footprint, exits 1 on first failed assertion. Each journey script
 * imports { createRunner } and drives the live stack through the gateway.
 *
 * Env:
 *   BASE_URL      gateway base (default http://localhost; use :8888 with the
 *                 docker-compose.override.yml port mapping)
 *   E2E_EMAIL     admin login (default admin@playgen.local)
 *   E2E_PASSWORD  admin password (default changeme)
 */

export const BASE = process.env.BASE_URL ?? 'http://localhost';
export const ADMIN_EMAIL = process.env.E2E_EMAIL ?? 'admin@playgen.local';
export const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'changeme';

export function createRunner(journeyName) {
  let token = '';
  let step = 0;
  let stepLabel = '';

  function setStep(n, label = '') {
    step = n;
    stepLabel = label;
  }

  function assert(cond, msg, extra) {
    if (!cond) {
      console.error(`\n✗ FAIL [${journeyName} step ${step}${stepLabel ? ` — ${stepLabel}` : ''}] ${msg}`);
      if (extra !== undefined) console.error('  detail:', JSON.stringify(extra, null, 2)?.slice(0, 2000));
      process.exit(1);
    }
    console.log(`✓ ${journeyName} step ${step}: ${msg}`);
  }

  async function api(path, { method = 'GET', body, headers: extraHeaders, raw = false, auth = true } = {}) {
    const headers = { ...(auth && token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (raw) {
      const buf = await res.arrayBuffer();
      return { status: res.status, headers: res.headers, bytes: buf.byteLength };
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  /**
   * Login as admin, remember the bearer token, return { user, companyId, tokens }.
   * If run-all.mjs already logged in (E2E_TOKEN env), reuse that session instead
   * of burning the auth service's 5-logins-per-minute rate limit — pass
   * { fresh: true } to force a real login (the auth journey needs one).
   */
  async function login(email = ADMIN_EMAIL, password = ADMIN_PASSWORD, { fresh = false } = {}) {
    if (!fresh && process.env.E2E_TOKEN) {
      token = process.env.E2E_TOKEN;
      const me = await api('/api/v1/me');
      assert(me.status === 200, 'shared E2E_TOKEN session is valid', me);
      // /me omits company_id — read it from the JWT's `cid` claim instead.
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const user = { ...(me.data?.user ?? me.data), company_id: claims.cid };
      assert(!!claims.cid, 'shared token carries a cid claim');
      return { user, companyId: claims.cid, tokens: { access_token: token } };
    }
    const res = await api('/api/v1/auth/login', { method: 'POST', body: { email, password } });
    assert(res.status === 200, `login as ${email}`, res);
    token = res.data?.tokens?.access_token ?? '';
    assert(!!token, 'login returns an access token');
    return { user: res.data.user, companyId: res.data.user?.company_id, tokens: res.data.tokens };
  }

  function setToken(t) { token = t; }
  function getToken() { return token; }

  /** Return the first station for the company, creating one if none exist. */
  async function ensureStation(companyId) {
    const list = await api(`/api/v1/companies/${companyId}/stations`);
    assert(list.status === 200, 'list stations returns 200', list);
    if (Array.isArray(list.data) && list.data[0]) return list.data[0];
    const created = await api(`/api/v1/companies/${companyId}/stations`, {
      method: 'POST',
      body: {
        name: `E2E Station ${Date.now()}`,
        timezone: 'Asia/Manila',
        broadcast_start_hour: 6,
        broadcast_end_hour: 22,
        // stations.active_days is varchar(3)[] — full day names 500 (see LESSONS)
        active_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      },
    });
    assert(created.status === 201 || created.status === 200, 'create station succeeds', created);
    return created.data;
  }

  /** Poll fn() until it returns truthy or timeoutMs elapses. */
  async function waitFor(fn, { timeoutMs = 60_000, intervalMs = 1_500, label = 'condition' } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await fn();
      if (result) return result;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    assert(false, `timed out after ${timeoutMs}ms waiting for ${label}`);
  }

  return { assert, api, login, ensureStation, waitFor, setStep, setToken, getToken };
}

export function finish(journeyName) {
  console.log(`\n${journeyName}: all assertions passed ✔`);
}
