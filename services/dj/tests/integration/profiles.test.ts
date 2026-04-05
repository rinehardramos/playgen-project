/**
 * Integration tests — DJ Profiles API
 *
 * Uses Fastify's built-in inject() for HTTP simulation against a real
 * PostgreSQL database (TEST_DATABASE_URL or DATABASE_URL env var).
 * Every test cleans up the rows it inserts so the suite is idempotent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, makeTestToken, closePool } from './helpers.js';

const COMPANY_ID = '00000000-1111-0000-0000-000000000001';
const TOKEN = makeTestToken({ company_id: COMPANY_ID });
const AUTH_HEADER = `Bearer ${TOKEN}`;

describe('DJ Profiles API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    // Clean up any profiles created by this test suite
    const { getPool } = await import('../../src/db.js');
    await getPool().query(
      `DELETE FROM dj_profiles WHERE company_id = $1`,
      [COMPANY_ID],
    );
    await app.close();
    await closePool();
  });

  // ── Auth guard ───────────────────────────────────────────────────────────────

  it('GET /api/v1/dj/profiles returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dj/profiles',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/dj/profiles returns 401 with a malformed token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dj/profiles',
      headers: { authorization: 'Bearer not-a-valid-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── List profiles ────────────────────────────────────────────────────────────

  it('GET /api/v1/dj/profiles returns 200 and an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dj/profiles',
      headers: { authorization: AUTH_HEADER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  // ── Create profile ───────────────────────────────────────────────────────────

  it('POST /api/v1/dj/profiles creates a profile and returns 201', async () => {
    const payload = {
      name: 'Integ Test DJ',
      personality: 'Energetic, friendly',
      voice_style: 'upbeat',
      llm_model: 'anthropic/claude-haiku-3',
      llm_temperature: 0.8,
      tts_provider: 'openai',
      tts_voice_id: 'alloy',
      is_default: false,
      is_active: true,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dj/profiles',
      headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Integ Test DJ');
    expect(body.company_id).toBe(COMPANY_ID);
    expect(body.is_default).toBe(false);
    expect(body.is_active).toBe(true);
  });

  // ── Full CRUD flow ───────────────────────────────────────────────────────────

  it('CRUD: creates, reads, updates, and deletes a profile', async () => {
    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dj/profiles',
      headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
      payload: {
        name: 'CRUD Test DJ',
        personality: 'Calm and informative',
        voice_style: 'professional',
        llm_model: 'anthropic/claude-haiku-3',
        llm_temperature: 0.5,
        tts_provider: 'openai',
        tts_voice_id: 'nova',
        is_default: false,
        is_active: true,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    const profileId = created.id as string;

    // Read single
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dj/profiles/${profileId}`,
      headers: { authorization: AUTH_HEADER },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(profileId);

    // Update
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dj/profiles/${profileId}`,
      headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
      payload: { name: 'Updated CRUD DJ', voice_style: 'mellow' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().name).toBe('Updated CRUD DJ');
    expect(patchRes.json().voice_style).toBe('mellow');

    // Delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dj/profiles/${profileId}`,
      headers: { authorization: AUTH_HEADER },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Confirm deletion
    const afterDeleteRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dj/profiles/${profileId}`,
      headers: { authorization: AUTH_HEADER },
    });
    expect(afterDeleteRes.statusCode).toBe(404);
  });

  // ── 404 for unknown profile ──────────────────────────────────────────────────

  it('GET /api/v1/dj/profiles/:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dj/profiles/00000000-0000-0000-0000-000000000000',
      headers: { authorization: AUTH_HEADER },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Cannot delete default profile ───────────────────────────────────────────

  it('DELETE cannot remove a default profile', async () => {
    // Create a default profile
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dj/profiles',
      headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
      payload: {
        name: 'Default DJ',
        personality: 'Reliable',
        voice_style: 'neutral',
        llm_model: 'anthropic/claude-haiku-3',
        llm_temperature: 0.7,
        tts_provider: 'openai',
        tts_voice_id: 'alloy',
        is_default: true,
        is_active: true,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { id: defaultId } = createRes.json();

    // Attempt to delete — should fail because is_default = true
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dj/profiles/${defaultId}`,
      headers: { authorization: AUTH_HEADER },
    });
    expect(deleteRes.statusCode).toBe(400);
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────────

  it('Profiles from a different company are not visible', async () => {
    // Token for a completely different company
    const otherToken = makeTestToken({ company_id: 'other-company-id' });

    // Create under original company
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dj/profiles',
      headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
      payload: {
        name: 'Isolation DJ',
        personality: 'Exclusive',
        voice_style: 'private',
        llm_model: 'anthropic/claude-haiku-3',
        llm_temperature: 0.6,
        tts_provider: 'openai',
        tts_voice_id: 'alloy',
        is_default: false,
        is_active: true,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { id: isolatedId } = createRes.json();

    // Fetch as other-company — should 404
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dj/profiles/${isolatedId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
