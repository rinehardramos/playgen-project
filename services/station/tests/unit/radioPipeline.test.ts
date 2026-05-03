/**
 * Unit tests for /stations/:id/pipeline/* routes
 *
 * Verifies:
 * - GET /stations/:id/pipeline/runs returns { runs: [], total: N }
 * - POST /stations/:id/pipeline/trigger returns pipeline_run_id + 202
 * - POST /stations/:id/pipeline/runs/:runId/retry/:stageName re-queues the run
 * - Retry rejects unknown stage names
 * - Retry rejects a currently-running run
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

// ─── Module mocks ──────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

vi.mock('../../src/queues/radioPipeline', async () => {
  const actual = await vi.importActual<typeof import('../../src/queues/radioPipeline')>(
    '../../src/queues/radioPipeline',
  );
  return {
    ...actual,
    getRadioPipelineQueue: vi.fn(() => ({
      add: vi.fn().mockResolvedValue({ id: 'bull-job-1' }),
    })),
  };
});

vi.mock('@playgen/middleware', () => ({
  authenticate: vi.fn(async (req: Record<string, unknown>) => {
    req.user = { sub: 'user-1', cid: 'company-1', rc: 'company_admin' };
  }),
  registerSecurity: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(sensible);
  const { default: radioPipelineRoutes } = await import('../../src/routes/radioPipeline');
  app.register(radioPipelineRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

const STATION_ID = 'station-uuid-1';
const RUN_ID = 'run-uuid-1';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /stations/:id/pipeline/runs', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns { runs, total } shape', async () => {
    const mockRun = {
      id: RUN_ID,
      station_id: STATION_ID,
      date: '2026-05-03',
      status: 'completed',
      triggered_by: 'manual',
      stage_playlist: { status: 'completed' },
      stage_dj_script: { status: 'completed' },
      stage_review: { status: 'skipped' },
      stage_tts: { status: 'completed' },
      stage_publish: { status: 'completed' },
      created_at: '2026-05-03T10:00:00Z',
      updated_at: '2026-05-03T10:05:00Z',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [mockRun] })   // rows query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }); // count query

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stations/${STATION_ID}/pipeline/runs`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('runs');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.total).toBe(1);
    expect(body.runs[0].id).toBe(RUN_ID);
  });

  it('respects limit query param (max 50)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stations/${STATION_ID}/pipeline/runs?limit=100`,
    });

    expect(res.statusCode).toBe(200);
    // The query should have been called with limit capped at 50
    const firstCall = mockQuery.mock.calls[0];
    expect(firstCall[1]).toContain(50);
  });
});

describe('POST /stations/:id/pipeline/trigger', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 202 with pipeline_run_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ timezone: 'Asia/Manila' }] })  // station lookup
      .mockResolvedValueOnce({ rows: [] })                              // active run check
      .mockResolvedValueOnce({ rows: [{ id: RUN_ID }] });              // insert run

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stations/${STATION_ID}/pipeline/trigger`,
      payload: {},
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.pipeline_run_id).toBe(RUN_ID);
    expect(body.status).toBe('queued');
  });

  it('returns 409 if a run is already active', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ timezone: 'Asia/Manila' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-run-id' }] }); // active run found

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stations/${STATION_ID}/pipeline/trigger`,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
  });
});

describe('POST /stations/:id/pipeline/runs/:runId/retry/:stageName', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 400 for unknown stage name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stations/${STATION_ID}/pipeline/runs/${RUN_ID}/retry/unknown_stage`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 if run not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stations/${STATION_ID}/pipeline/runs/${RUN_ID}/retry/generate_playlist`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 if run is currently running', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: RUN_ID, status: 'running', stages_completed: {} }],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stations/${STATION_ID}/pipeline/runs/${RUN_ID}/retry/generate_playlist`,
    });
    expect(res.statusCode).toBe(409);
  });

  it('clears the retried stage and downstream, re-queues the run', async () => {
    const { getRadioPipelineQueue } = await import('../../src/queues/radioPipeline');
    const mockAdd = vi.fn().mockResolvedValue({ id: 'new-bull-id' });
    (getRadioPipelineQueue as ReturnType<typeof vi.fn>).mockReturnValue({ add: mockAdd });

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: RUN_ID,
          status: 'failed',
          stages_completed: { generate_playlist: { playlist_id: 'p1' } },
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stations/${STATION_ID}/pipeline/runs/${RUN_ID}/retry/generate_script`,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.pipeline_run_id).toBe(RUN_ID);
    expect(body.stage).toBe('generate_script');

    // The UPDATE should have been called
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toMatch(/UPDATE pipeline_runs/i);

    // generate_playlist should be preserved; generate_script+ should be cleared
    const stagesArg = JSON.parse(updateCall[1][0] as string);
    expect(stagesArg).toHaveProperty('generate_playlist');
    expect(stagesArg).not.toHaveProperty('generate_script');
    expect(stagesArg).not.toHaveProperty('generate_tts');
    expect(stagesArg).not.toHaveProperty('publish');

    // Job was re-queued
    expect(mockAdd).toHaveBeenCalledWith(
      'pipeline',
      expect.objectContaining({ station_id: STATION_ID, pipeline_run_id: RUN_ID }),
      expect.any(Object),
    );
  });
});
