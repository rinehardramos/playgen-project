import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks must be defined before any imports that use them ---

const mockStorageExists = vi.fn();
const mockStorageDelete = vi.fn();

vi.mock('../../src/lib/storage/index.js', () => ({
  getStorageAdapter: () => ({
    exists: mockStorageExists,
    delete: mockStorageDelete,
  }),
}));

const mockQuery = vi.fn();

vi.mock('../../src/db.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));

vi.mock('../../src/config.js', () => ({
  config: {
    audioRetentionDays: 30,
    redis: { host: 'localhost', port: 6379 },
  },
}));

// BullMQ queue/worker are not needed for unit-testing runAudioCleanup
vi.mock('bullmq', () => ({
  Queue: class {
    add = vi.fn();
    close = vi.fn();
    getRepeatableJobs = vi.fn().mockResolvedValue([]);
    removeRepeatableByKey = vi.fn();
  },
  Worker: class {
    on = vi.fn();
    close = vi.fn();
  },
}));

import { runAudioCleanup } from '../../src/queues/audioCleanupQueue.js';

describe('runAudioCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes audio files and clears DB refs for expired segments', async () => {
    // Simulate two segments with audio generated before the cutoff
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'seg-1', audio_url: '/dj/audio/script-abc/0.mp3' },
          { id: 'seg-2', audio_url: '/dj/audio/script-abc/1.mp3' },
        ],
      })
      // Two UPDATE calls — one per segment
      .mockResolvedValue({ rows: [] });

    mockStorageExists.mockResolvedValue(true);
    mockStorageDelete.mockResolvedValue(undefined);

    await runAudioCleanup(30);

    // Storage.exists called for each segment
    expect(mockStorageExists).toHaveBeenCalledTimes(2);
    expect(mockStorageExists).toHaveBeenCalledWith('script-abc/0.mp3');
    expect(mockStorageExists).toHaveBeenCalledWith('script-abc/1.mp3');

    // Storage.delete called for each segment
    expect(mockStorageDelete).toHaveBeenCalledTimes(2);

    // DB UPDATE called for each segment to clear audio_url
    const updateCalls = mockQuery.mock.calls.filter((c) =>
      (c[0] as string).includes('UPDATE dj_segments'),
    );
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][1]).toContain('seg-1');
    expect(updateCalls[1][1]).toContain('seg-2');
  });

  it('still clears DB ref even when file is not found in storage', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'seg-3', audio_url: '/dj/audio/script-xyz/2.mp3' }],
      })
      .mockResolvedValue({ rows: [] });

    mockStorageExists.mockResolvedValue(false); // file already gone
    mockStorageDelete.mockResolvedValue(undefined);

    await runAudioCleanup(7);

    // Delete should NOT have been called (file didn't exist)
    expect(mockStorageDelete).not.toHaveBeenCalled();

    // DB ref should still be cleared
    const updateCalls = mockQuery.mock.calls.filter((c) =>
      (c[0] as string).includes('UPDATE dj_segments'),
    );
    expect(updateCalls).toHaveLength(1);
  });

  it('continues processing remaining segments when one fails', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'seg-4', audio_url: '/dj/audio/script-err/0.mp3' },
          { id: 'seg-5', audio_url: '/dj/audio/script-err/1.mp3' },
        ],
      })
      .mockResolvedValue({ rows: [] });

    mockStorageExists
      .mockRejectedValueOnce(new Error('S3 network error')) // seg-4 fails
      .mockResolvedValueOnce(true); // seg-5 succeeds
    mockStorageDelete.mockResolvedValue(undefined);

    // Should not throw even though one segment errored
    await expect(runAudioCleanup(30)).resolves.toBeUndefined();

    // seg-5 should still be deleted
    expect(mockStorageDelete).toHaveBeenCalledTimes(1);
    expect(mockStorageDelete).toHaveBeenCalledWith('script-err/1.mp3');
  });

  it('does nothing when no segments are found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runAudioCleanup(30);

    expect(mockStorageExists).not.toHaveBeenCalled();
    expect(mockStorageDelete).not.toHaveBeenCalled();
    // Only the SELECT query should have been executed
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
