import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { ProgramManifest } from '../../src/services/manifestService.js';

const MANIFEST: ProgramManifest = {
  version: 1,
  station_id: 'station-1',
  episode_id: 'episode-abc',
  air_date: '2026-04-23',
  total_duration_sec: 3600,
  segments: [],
};

describe('POST /internal/manifests/build → triggerPlayout', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls triggerPlayout with the returned manifest after a successful build', async () => {
    const mockBuild = vi.fn().mockResolvedValue(MANIFEST);
    const mockTrigger = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../../src/services/manifestService', () => ({
      buildProgramManifest: mockBuild,
      getManifestByScript: vi.fn(),
    }));
    vi.doMock('../../src/playout/playoutTrigger', () => ({
      triggerPlayout: mockTrigger,
    }));

    const { manifestRoutes } = await import('../../src/routes/manifests');

    const app = Fastify();
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error); }
    });
    await app.register(manifestRoutes);
    await app.ready();

    const resp = await app.inject({
      method: 'POST',
      url: '/internal/manifests/build',
      payload: { episode_id: 'episode-abc' },
    });

    expect(resp.statusCode).toBe(200);
    // Allow the fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(mockTrigger).toHaveBeenCalledOnce();
    expect(mockTrigger).toHaveBeenCalledWith(MANIFEST);

    await app.close();
  });
});
