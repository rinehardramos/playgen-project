/**
 * Unit tests for dailyProgramJob.ts
 *
 * The job depends on a PostgreSQL pool (via getPool) and enqueueGeneration.
 * Both are mocked here so the logic can be exercised without a real database
 * or Redis connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the db module before importing the job so getPool returns our stub.
vi.mock('../../src/db', () => ({
  getPool: vi.fn(),
}));

// Mock enqueueGeneration so we don't need a real Redis / BullMQ connection.
vi.mock('../../src/services/queueService', () => ({
  enqueueGeneration: vi.fn(),
}));

import { getPool } from '../../src/db';
import { enqueueGeneration } from '../../src/services/queueService';
import { runDailyProgramGeneration, scheduleDailyGeneration, stopDailyGeneration } from '../../src/jobs/dailyProgramJob';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal pg Pool mock with a controllable query function. */
function makePoolMock(queryImpl: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  return { query: vi.fn(queryImpl) };
}

/**
 * Return tomorrow's date string (YYYY-MM-DD) using the same logic as the job,
 * so test assertions stay in sync regardless of when they run.
 */
function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runDailyProgramGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues one job per active program with no existing playlists', async () => {
    const targetDate = tomorrowDateString();

    const pool = makePoolMock((sql) => {
      // First query: programs
      if (sql.includes('FROM programs')) {
        return {
          rows: [
            { id: 'prog-1', station_id: 'station-a', template_id: 'tpl-1' },
            { id: 'prog-2', station_id: 'station-b', template_id: null },
          ],
        };
      }
      // Second query: existing playlists — none
      if (sql.includes('FROM playlists')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    vi.mocked(getPool).mockReturnValue(pool as never);
    vi.mocked(enqueueGeneration).mockResolvedValue('job-id-1');

    await runDailyProgramGeneration();

    expect(enqueueGeneration).toHaveBeenCalledTimes(2);
    expect(enqueueGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        stationId: 'station-a',
        date: targetDate,
        templateId: 'tpl-1',
        triggeredBy: 'cron',
      }),
    );
    expect(enqueueGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        stationId: 'station-b',
        date: targetDate,
        templateId: undefined,
        triggeredBy: 'cron',
      }),
    );
  });

  it('skips stations that already have a non-failed playlist', async () => {
    const pool = makePoolMock((sql) => {
      if (sql.includes('FROM programs')) {
        return {
          rows: [{ id: 'prog-1', station_id: 'station-a', template_id: null }],
        };
      }
      if (sql.includes('FROM playlists')) {
        // station-a already has an approved playlist
        return { rows: [{ station_id: 'station-a', status: 'approved' }] };
      }
      return { rows: [] };
    });

    vi.mocked(getPool).mockReturnValue(pool as never);

    await runDailyProgramGeneration();

    expect(enqueueGeneration).not.toHaveBeenCalled();
  });

  it('does not enqueue twice for the same station when multiple programs share it', async () => {
    const pool = makePoolMock((sql) => {
      if (sql.includes('FROM programs')) {
        // Two programs on the same station
        return {
          rows: [
            { id: 'prog-1', station_id: 'station-x', template_id: 'tpl-1' },
            { id: 'prog-2', station_id: 'station-x', template_id: 'tpl-2' },
          ],
        };
      }
      if (sql.includes('FROM playlists')) {
        return { rows: [] }; // no existing playlists
      }
      return { rows: [] };
    });

    vi.mocked(getPool).mockReturnValue(pool as never);
    vi.mocked(enqueueGeneration).mockResolvedValue('job-id-x');

    await runDailyProgramGeneration();

    // Only the first program should result in an enqueue; the second is skipped
    // because the station was added to skipSet after the first enqueue.
    expect(enqueueGeneration).toHaveBeenCalledTimes(1);
    expect(enqueueGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ stationId: 'station-x', templateId: 'tpl-1' }),
    );
  });

  it('returns without enqueueing when no programs are active for tomorrow', async () => {
    const pool = makePoolMock((sql) => {
      if (sql.includes('FROM programs')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    vi.mocked(getPool).mockReturnValue(pool as never);

    await runDailyProgramGeneration();

    // playlists query should never be reached
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(enqueueGeneration).not.toHaveBeenCalled();
  });

  it('handles enqueueGeneration failures gracefully and continues with remaining programs', async () => {
    const pool = makePoolMock((sql) => {
      if (sql.includes('FROM programs')) {
        return {
          rows: [
            { id: 'prog-1', station_id: 'station-ok', template_id: null },
            { id: 'prog-2', station_id: 'station-fail', template_id: null },
          ],
        };
      }
      if (sql.includes('FROM playlists')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    vi.mocked(getPool).mockReturnValue(pool as never);
    vi.mocked(enqueueGeneration)
      .mockResolvedValueOnce('job-ok')
      .mockRejectedValueOnce(new Error('Redis unavailable'));

    // Should not throw
    await expect(runDailyProgramGeneration()).resolves.toBeUndefined();
    expect(enqueueGeneration).toHaveBeenCalledTimes(2);
  });

  it('returns early when the programs query fails', async () => {
    const pool = makePoolMock((sql) => {
      if (sql.includes('FROM programs')) {
        throw new Error('DB connection error');
      }
      return { rows: [] };
    });

    vi.mocked(getPool).mockReturnValue(pool as never);

    await expect(runDailyProgramGeneration()).resolves.toBeUndefined();
    expect(enqueueGeneration).not.toHaveBeenCalled();
  });

  it('returns early when the playlists idempotency query fails', async () => {
    const pool = makePoolMock((sql) => {
      if (sql.includes('FROM programs')) {
        return {
          rows: [{ id: 'prog-1', station_id: 'station-a', template_id: null }],
        };
      }
      if (sql.includes('FROM playlists')) {
        throw new Error('DB connection error');
      }
      return { rows: [] };
    });

    vi.mocked(getPool).mockReturnValue(pool as never);

    await expect(runDailyProgramGeneration()).resolves.toBeUndefined();
    expect(enqueueGeneration).not.toHaveBeenCalled();
  });
});

describe('scheduleDailyGeneration / stopDailyGeneration', () => {
  afterEach(() => {
    // Always stop after each test to reset module-level state
    stopDailyGeneration();
    delete process.env.DAILY_GENERATION_HOUR;
    delete process.env.DAILY_PROGRAM_CRON;
  });

  it('registers a cron task without throwing', () => {
    expect(() => scheduleDailyGeneration()).not.toThrow();
    // Confirm stop cleans up without throwing
    expect(() => stopDailyGeneration()).not.toThrow();
  });

  it('ignores duplicate calls (idempotent start)', () => {
    scheduleDailyGeneration();
    // Second call should warn but not throw
    expect(() => scheduleDailyGeneration()).not.toThrow();
  });

  it('respects DAILY_GENERATION_HOUR env var', () => {
    process.env.DAILY_GENERATION_HOUR = '5';
    expect(() => scheduleDailyGeneration()).not.toThrow();
  });

  it('respects DAILY_PROGRAM_CRON env var override', () => {
    process.env.DAILY_PROGRAM_CRON = '30 3 * * *';
    expect(() => scheduleDailyGeneration()).not.toThrow();
  });

  it('throws on an invalid DAILY_PROGRAM_CRON expression', () => {
    process.env.DAILY_PROGRAM_CRON = 'not-a-cron';
    expect(() => scheduleDailyGeneration()).toThrow(/Invalid cron expression/);
  });

  it('stopDailyGeneration is safe to call when not started', () => {
    expect(() => stopDailyGeneration()).not.toThrow();
  });
});
