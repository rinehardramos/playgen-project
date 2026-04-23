import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProgramManifest } from '../../src/services/manifestService.js';

const MANIFEST: ProgramManifest = {
  version: 1,
  station_id: 'station-1',
  episode_id: 'episode-1',
  air_date: '2026-04-23',
  total_duration_sec: 3600,
  segments: [],
};

describe('playoutTrigger', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Reset env vars
    delete process.env.OWNRADIO_WEBHOOK_URL;
    delete process.env.PLAYGEN_WEBHOOK_SECRET;
    delete process.env.GATEWAY_URL;
  });

  it('happy path: startPlayout → generateHls → fetch webhook called', async () => {
    const mockState = { stationId: 'station-1', status: 'generating' };
    const mockStartPlayout = vi.fn().mockResolvedValue(mockState);
    const mockGenerateHls = vi.fn().mockResolvedValue({ stationId: 'station-1', totalSegments: 5 });
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ slug: 'my-station' }] });
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock('../../src/playout/playoutScheduler', () => ({
      startPlayout: mockStartPlayout,
    }));
    vi.doMock('../../src/playout/hlsGenerator', () => ({
      generateHls: mockGenerateHls,
    }));
    vi.doMock('../../src/db', () => ({
      getPool: () => ({ query: mockQuery }),
    }));
    vi.stubGlobal('fetch', mockFetch);

    process.env.OWNRADIO_WEBHOOK_URL = 'https://ownradio.net';
    process.env.GATEWAY_URL = 'https://api.playgen.site';

    const { triggerPlayout } = await import('../../src/playout/playoutTrigger');
    await triggerPlayout(MANIFEST);

    expect(mockStartPlayout).toHaveBeenCalledWith('station-1');
    expect(mockGenerateHls).toHaveBeenCalledWith('station-1', MANIFEST);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://ownradio.net/webhooks/stations/my-station/stream-control');
    expect(JSON.parse(opts.body)).toMatchObject({
      action: 'url_change',
      streamUrl: 'https://api.playgen.site/stream/station-1/playlist.m3u8',
    });
  });

  it('startPlayout returns null → generateHls NOT called', async () => {
    const mockStartPlayout = vi.fn().mockResolvedValue(null);
    const mockGenerateHls = vi.fn();
    const mockFetch = vi.fn();

    vi.doMock('../../src/playout/playoutScheduler', () => ({
      startPlayout: mockStartPlayout,
    }));
    vi.doMock('../../src/playout/hlsGenerator', () => ({
      generateHls: mockGenerateHls,
    }));
    vi.doMock('../../src/db', () => ({
      getPool: () => ({ query: vi.fn() }),
    }));
    vi.stubGlobal('fetch', mockFetch);

    process.env.OWNRADIO_WEBHOOK_URL = 'https://ownradio.net';

    const { triggerPlayout } = await import('../../src/playout/playoutTrigger');
    await triggerPlayout(MANIFEST);

    expect(mockGenerateHls).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('generateHls throws → fetch NOT called', async () => {
    const mockStartPlayout = vi.fn().mockResolvedValue({ stationId: 'station-1', status: 'generating' });
    const mockGenerateHls = vi.fn().mockRejectedValue(new Error('ffmpeg failed'));
    const mockFetch = vi.fn();

    vi.doMock('../../src/playout/playoutScheduler', () => ({
      startPlayout: mockStartPlayout,
    }));
    vi.doMock('../../src/playout/hlsGenerator', () => ({
      generateHls: mockGenerateHls,
    }));
    vi.doMock('../../src/db', () => ({
      getPool: () => ({ query: vi.fn() }),
    }));
    vi.stubGlobal('fetch', mockFetch);

    process.env.OWNRADIO_WEBHOOK_URL = 'https://ownradio.net';

    const { triggerPlayout } = await import('../../src/playout/playoutTrigger');
    await triggerPlayout(MANIFEST);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('missing OWNRADIO_WEBHOOK_URL → fetch NOT called', async () => {
    const mockStartPlayout = vi.fn().mockResolvedValue({ stationId: 'station-1', status: 'generating' });
    const mockGenerateHls = vi.fn().mockResolvedValue({ stationId: 'station-1', totalSegments: 3 });
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ slug: 'my-station' }] });
    const mockFetch = vi.fn();

    vi.doMock('../../src/playout/playoutScheduler', () => ({
      startPlayout: mockStartPlayout,
    }));
    vi.doMock('../../src/playout/hlsGenerator', () => ({
      generateHls: mockGenerateHls,
    }));
    vi.doMock('../../src/db', () => ({
      getPool: () => ({ query: mockQuery }),
    }));
    vi.stubGlobal('fetch', mockFetch);

    // OWNRADIO_WEBHOOK_URL is intentionally not set

    const { triggerPlayout } = await import('../../src/playout/playoutTrigger');
    await triggerPlayout(MANIFEST);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
