#!/usr/bin/env node
/**
 * Run every e2e journey sequentially against the live stack and summarize.
 *
 * Usage:
 *   BASE_URL=http://localhost:8888 node e2e/run-all.mjs
 *   BASE_URL=http://localhost:8888 node e2e/run-all.mjs auth library   # subset
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BASE, ADMIN_EMAIL, ADMIN_PASSWORD } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Login once and share the token with every journey via E2E_TOKEN — the auth
// service rate-limits POST /auth/login to 5/minute, so 8 fresh logins in a row
// would 429 (the auth journey still does its own real login to test the flow).
if (!process.env.E2E_TOKEN) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await res.json().catch(() => null);
  const token = data?.tokens?.access_token;
  if (!token) {
    console.error(`✗ run-all: shared admin login failed (${res.status})`, data);
    process.exit(1);
  }
  process.env.E2E_TOKEN = token;
}

const JOURNEYS = [
  'auth',
  'stations',
  'users-roles',
  'library',
  'programs',
  'scheduler-playlist',
  'analytics',
  'dj',
];

const requested = process.argv.slice(2);
const toRun = requested.length
  ? JOURNEYS.filter(j => requested.some(req => j.includes(req)))
  : JOURNEYS;

const results = [];
for (const journey of toRun) {
  const script = path.join(here, `${journey}-journey.mjs`);
  console.log(`\n━━━ ${journey} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  const started = Date.now();
  const res = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
  results.push({ journey, ok: res.status === 0, ms: Date.now() - started });
}

console.log('\n━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const { journey, ok, ms } of results) {
  console.log(`${ok ? '✔' : '✗'} ${journey.padEnd(20)} ${(ms / 1000).toFixed(1)}s`);
}
const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.error(`\n${failed.length}/${results.length} journeys failed`);
  process.exit(1);
}
console.log(`\nAll ${results.length} journeys passed ✔`);
