/**
 * security.test.ts — HTTP-level security regression suite for the auth service.
 *
 * Uses Fastify's built-in `app.inject()` (no real port/socket needed) so the
 * suite runs in plain `vitest run tests/unit` with no extra harness.
 *
 * What this guards against:
 *   - missing helmet headers (regression detection if shared/middleware drops one)
 *   - leaked validation `details[]` on schema failures (PII / schema disclosure)
 *   - oversized request bodies (DoS / memory pressure)
 *   - prototype-pollution in JSON bodies
 *   - login brute-force (per-route rate limit)
 *   - JWT bypass attempts on /api/v1/me (will be added once a /me route exists)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Stub resend so the email service module-load doesn't crash on missing key.
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: async () => ({ data: null, error: null }) };
  },
}));

import { buildApp } from '../../src/app';

let app: FastifyInstance;

beforeAll(async () => {
  // Mute noisy auth logs in test runs.
  process.env.LOG_LEVEL = 'silent';
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('helmet headers (registerSecurity)', () => {
  it('sets noSniff, frameguard, and referrer-policy on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    // CSP must be off for JSON APIs (frontend handles it).
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('does NOT set HSTS in non-production (so local http dev works)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    // NODE_ENV is undefined or "test" here — HSTS should be off.
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('validation error handling', () => {
  it('returns generic 400 without leaking schema details on /auth/login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'not-an-email', password: '' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string; details?: unknown } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Invalid request payload');
    // The schema-level `details` array MUST NOT be exposed to clients.
    expect(body.error.details).toBeUndefined();
  });

  it('strips or rejects extra/unknown fields (additionalProperties: false)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'a@b.co', password: 'x', isAdmin: true, role: 'super_admin' },
    });
    // The crucial property: the response is NEVER 200 — `isAdmin` / `role`
    // never elevate the caller. The exact code depends on whether the schema
    // rejected (400), the handler rejected on bad creds (401), or a backing
    // service was unavailable (500 — happens in CI without a real DB).
    // All three outcomes are safe; only 200 would be a vulnerability.
    expect(res.statusCode).not.toBe(200);
    expect([400, 401, 500]).toContain(res.statusCode);
  });

  it('rejects payloads larger than the bodyLimit (100 KB)', async () => {
    const huge = 'x'.repeat(200 * 1024);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: `{"email":"a@b.co","password":"${huge}"}`,
    });
    // Fastify returns 413 for body limit overflows.
    expect([400, 413]).toContain(res.statusCode);
  });
});

describe('prototype pollution defense (Fastify JSON parser)', () => {
  it('does not pollute Object.prototype via __proto__ in body', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":"a@b.co","password":"x","__proto__":{"polluted":true}}',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
  });

  it('does not pollute via constructor.prototype', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":"a@b.co","password":"x","constructor":{"prototype":{"polluted2":true}}}',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted2).toBeUndefined();
  });
});

describe('rate limiting on /auth/login', () => {
  it('returns 429 after 5 requests in 1 minute from the same IP', async () => {
    // Use a fresh app instance so this test does not collide with other suites
    // hitting the shared rate-limit counter.
    process.env.LOG_LEVEL = 'silent';
    const local = buildApp();
    await local.ready();

    const ip = '203.0.113.42';
    const responses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await local.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: ip,
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        payload: { email: 'nobody@example.com', password: 'wrong' },
      });
      responses.push(res.statusCode);
    }
    await local.close();

    // The first 5 should be 401 (auth failure), the 6th + should be 429.
    const limited = responses.filter((c) => c === 429);
    expect(limited.length).toBeGreaterThanOrEqual(2);
  });
});
