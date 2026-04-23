import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('playoutScheduler status', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('getPlayoutStatus returns null for an unknown station', async () => {
    vi.doMock('../../src/db', () => ({
      getPool: () => ({ query: vi.fn() }),
    }));
    vi.doMock('../../src/lib/storage/index', () => ({
      getStorageAdapter: () => ({ read: vi.fn() }),
    }));

    const { getPlayoutStatus } = await import('../../src/playout/playoutScheduler');
    expect(getPlayoutStatus('unknown-station')).toBeNull();
  });

  it('stopPlayout does not throw for unknown stations', async () => {
    vi.doMock('../../src/db', () => ({
      getPool: () => ({ query: vi.fn() }),
    }));
    vi.doMock('../../src/lib/storage/index', () => ({
      getStorageAdapter: () => ({ read: vi.fn() }),
    }));

    const { stopPlayout } = await import('../../src/playout/playoutScheduler');
    expect(() => stopPlayout('nonexistent-station')).not.toThrow();
  });
});
