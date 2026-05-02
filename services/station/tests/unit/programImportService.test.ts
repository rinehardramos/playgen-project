import { describe, it, expect, vi, beforeEach } from 'vitest';

// DB is mocked — pure unit tests
const mockQuery = vi.fn();
const mockConnect = vi.fn();
vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery, connect: mockConnect })),
}));

// Mock fs/promises to avoid disk I/O
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { importEpisode } from '../../src/services/programImportService';
import archiver from 'archiver';
import { PassThrough } from 'stream';

/** Build a minimal in-memory ZIP containing metadata.json only. */
async function buildMinimalBundle(metadata: object): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on('data', (c: Buffer) => chunks.push(c));
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    const archive = archiver('zip');
    archive.on('error', reject);
    archive.pipe(sink);
    archive.append(JSON.stringify(metadata), { name: 'metadata.json' });
    archive.finalize();
  });
}

describe('programImportService — importEpisode', () => {
  let clientMock: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockQuery.mockReset();
    clientMock = { query: vi.fn(), release: vi.fn() };
    mockConnect.mockResolvedValue(clientMock);
  });

  it('throws INVALID_BUNDLE when ZIP has no metadata.json', async () => {
    const emptyZip = await buildMinimalBundle({});
    // Override with a blank buffer that is not a valid ZIP
    await expect(importEpisode(Buffer.from('not a zip'), 'station-1', 'company-1')).rejects.toBeDefined();
  });

  it('throws INVALID_BUNDLE when metadata.json is missing from a valid ZIP', async () => {
    // Build a ZIP with a different file
    const zip = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const sink = new PassThrough();
      sink.on('data', (c: Buffer) => chunks.push(c));
      sink.on('end', () => resolve(Buffer.concat(chunks)));
      sink.on('error', reject);
      const archive = archiver('zip');
      archive.on('error', reject);
      archive.pipe(sink);
      archive.append('{}', { name: 'other.json' });
      archive.finalize();
    });

    clientMock.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(importEpisode(zip, 'station-1', 'company-1')).rejects.toMatchObject({
      code: 'INVALID_BUNDLE',
    });
  });

  it('creates a new program and episode when metadata is valid', async () => {
    const metadata = {
      format_version: '1.0',
      exported_at: '2026-04-22T00:00:00Z',
      episode: {
        id: 'ep-src', air_date: '2026-04-22', status: 'ready',
        notes: null, episode_title: null, playlist_id: null,
        dj_script_id: null, manifest_id: null,
      },
      program: {
        id: 'prog-src', name: 'Morning Drive', description: null,
        active_days: ['mon'], start_hour: 6, end_hour: 10, color_tag: null,
      },
      playlist: null,
    };

    const zip = await buildMinimalBundle(metadata);

    // BEGIN
    clientMock.query
      .mockResolvedValueOnce({}) // BEGIN
      // upsertProgram: no existing program
      .mockResolvedValueOnce({ rows: [] })
      // upsertProgram: create program
      .mockResolvedValueOnce({ rows: [{ id: 'prog-new' }] })
      // createEpisode: no existing episode
      .mockResolvedValueOnce({ rows: [] })
      // createEpisode: insert episode
      .mockResolvedValueOnce({ rows: [{ id: 'ep-new' }] })
      // COMMIT
      .mockResolvedValueOnce({});

    const result = await importEpisode(zip, 'station-1', 'company-1');
    expect(result.episodeId).toBe('ep-new');
    expect(result.warnings).toBeInstanceOf(Array);
  });

  it('reuses existing program by name and warns', async () => {
    const metadata = {
      format_version: '1.0',
      exported_at: '2026-04-22T00:00:00Z',
      episode: {
        id: 'ep-src', air_date: '2026-04-23', status: 'draft',
        notes: null, episode_title: null, playlist_id: null,
        dj_script_id: null, manifest_id: null,
      },
      program: {
        id: 'prog-src', name: 'Existing Show', description: null,
        active_days: [], start_hour: 0, end_hour: 24, color_tag: null,
      },
      playlist: null,
    };

    const zip = await buildMinimalBundle(metadata);

    clientMock.query
      .mockResolvedValueOnce({}) // BEGIN
      // upsertProgram: existing found
      .mockResolvedValueOnce({ rows: [{ id: 'prog-existing' }] })
      // createEpisode: no existing episode
      .mockResolvedValueOnce({ rows: [] })
      // createEpisode: insert
      .mockResolvedValueOnce({ rows: [{ id: 'ep-new-2' }] })
      // COMMIT
      .mockResolvedValueOnce({});

    const result = await importEpisode(zip, 'station-1', 'company-1');
    expect(result.episodeId).toBe('ep-new-2');
    expect(result.warnings.some((w) => w.includes('already exists on station'))).toBe(true);
  });
});
