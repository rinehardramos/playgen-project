#!/usr/bin/env node
/**
 * End-to-end walkthrough of the Programs user journey (docs/user-journey-programs.md).
 *
 * Hits the live local stack via the gateway at BASE_URL (default http://localhost)
 * and asserts every step of the happy path. Runs as a plain Node script so it has
 * zero install footprint — no Playwright download, no browser binaries. This is
 * the automated regression for the user journey document.
 *
 * Exit 0 = all assertions passed.
 * Exit 1 = any assertion failed (prints the failing step + response body).
 *
 * Usage:
 *   node e2e/programs-journey.mjs
 *   BASE_URL=http://localhost pnpm run test:e2e:programs
 */

const BASE = process.env.BASE_URL ?? 'http://localhost';
const ADMIN_EMAIL = process.env.E2E_EMAIL ?? 'admin@playgen.local';
const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'changeme';

let token = '';
let step = 0;

function assert(cond, msg, extra) {
  if (!cond) {
    console.error(`\n✗ FAIL [step ${step}] ${msg}`);
    if (extra !== undefined) console.error('  detail:', extra);
    process.exit(1);
  }
  console.log(`✓ step ${step}: ${msg}`);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function main() {
  // Step 1 — login
  step = 1;
  const login = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  assert(login.status === 200, 'admin can log in', login);
  token = login.data?.tokens?.access_token;
  assert(!!token, 'login returns an access token');
  const companyId = login.data?.user?.company_id;
  assert(!!companyId, 'login returns company_id');

  // Step 2 — stations list endpoint (the one the Programs page actually uses now)
  step = 2;
  const stationsList = await api(`/api/v1/companies/${companyId}/stations`);
  assert(stationsList.status === 200, 'list stations returns 200', stationsList);
  assert(Array.isArray(stationsList.data), 'stations response is an array');

  // Step 3 — ensure at least one station exists (create one if not)
  step = 3;
  let station = stationsList.data[0];
  if (!station) {
    const created = await api(`/api/v1/companies/${companyId}/stations`, {
      method: 'POST',
      body: {
        name: `E2E Station ${Date.now()}`,
        timezone: 'Asia/Manila',
        broadcast_start_hour: 6,
        broadcast_end_hour: 22,
        active_days: ['monday','tuesday','wednesday','thursday','friday'],
      },
    });
    assert(created.status === 201 || created.status === 200, 'create station succeeds', created);
    station = created.data;
  }
  assert(!!station?.id, 'have a station id');

  // Step 4 — create a program (use a unique name so re-runs don't collide)
  step = 4;
  const progName = `Morning Rush ${Date.now()}`;
  const progCreate = await api(`/api/v1/stations/${station.id}/programs`, {
    method: 'POST',
    body: {
      name: progName,
      description: 'E2E happy path program',
      active_days: ['monday','tuesday','wednesday','thursday','friday'],
      start_hour: 6,
      end_hour: 10,
      color_tag: '#7c3aed',
    },
  });
  assert(progCreate.status === 201, 'POST /stations/:id/programs returns 201', progCreate);
  const program = progCreate.data;
  assert(!!program?.id, 'create returns a program id');

  // Step 5 — fetch the program via the top-level /programs/:id route (the one that 502'd)
  step = 5;
  const progGet = await api(`/api/v1/programs/${program.id}`);
  assert(progGet.status === 200, 'GET /programs/:id returns 200 (gateway routes top-level program)', progGet);
  assert(progGet.data?.name === progName, 'fetched program matches created name');

  // Step 6 — fetch clocks (initially empty)
  step = 6;
  const clocksEmpty = await api(`/api/v1/programs/${program.id}/clocks`);
  assert(clocksEmpty.status === 200, 'GET /programs/:id/clocks returns 200', clocksEmpty);
  assert(Array.isArray(clocksEmpty.data), 'clocks response is an array');

  // Step 7 — create a Show Clock with a couple of slots
  step = 7;
  const clockCreate = await api(`/api/v1/programs/${program.id}/clocks`, {
    method: 'POST',
    body: {
      name: 'Standard Hour',
      is_default: true,
      slots: [
        { position: 1, content_type: 'station_id', duration_est_sec: 10, is_required: true },
        { position: 2, content_type: 'song',        duration_est_sec: 180, is_required: true },
        { position: 3, content_type: 'dj_segment',  segment_type: 'song_intro', duration_est_sec: 20, is_required: true },
        { position: 4, content_type: 'song',        duration_est_sec: 200, is_required: true },
      ],
    },
  });
  assert(clockCreate.status === 201, 'POST /programs/:id/clocks returns 201', clockCreate);
  assert(Array.isArray(clockCreate.data?.slots) && clockCreate.data.slots.length === 4, 'created clock has 4 slots');

  // Step 8 — re-fetch clocks and assert persistence
  step = 8;
  const clocksAfter = await api(`/api/v1/programs/${program.id}/clocks`);
  assert(clocksAfter.status === 200, 'clocks list after create returns 200');
  assert(
    clocksAfter.data.some(c => c.is_default && c.slots.length === 4),
    'persisted default clock round-trips with 4 slots',
    clocksAfter.data,
  );

  // Step 9 — list episodes for current month (empty, but the endpoint must work)
  step = 9;
  const monthKey = new Date().toISOString().slice(0, 7);
  const eps = await api(`/api/v1/programs/${program.id}/episodes?month=${monthKey}`);
  assert(eps.status === 200, 'GET /programs/:id/episodes returns 200', eps);
  assert(Array.isArray(eps.data), 'episodes response is an array');

  // Step 10 — update program via PUT
  step = 10;
  const putRes = await api(`/api/v1/programs/${program.id}`, {
    method: 'PUT',
    body: { name: `${progName} (edited)`, description: 'edited desc', is_active: true },
  });
  assert(putRes.status === 200, 'PUT /programs/:id returns 200', putRes);
  assert(putRes.data?.name?.endsWith('(edited)'), 'update persists name change');

  // Step 11 — delete program (non-default, should succeed)
  step = 11;
  const delRes = await api(`/api/v1/programs/${program.id}`, { method: 'DELETE' });
  assert(delRes.status === 204, 'DELETE /programs/:id returns 204', delRes);

  console.log('\nAll user-journey assertions passed ✔');
}

main().catch(err => {
  console.error(`\n✗ FAIL [step ${step}] unhandled error`);
  console.error(err);
  process.exit(1);
});
