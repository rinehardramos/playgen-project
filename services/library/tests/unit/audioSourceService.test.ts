import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// execFile mock — captured per test so we can inspect yt-dlp args
const mockExecFileAsync = vi.fn();

vi.mock('child_process', () => ({ execFile: vi.fn() }));

// promisify: return our async mock when called with any fn
vi.mock('util', () => ({
  promisify: () => mockExecFileAsync,
}));

const mockQuery = vi.fn();
vi.mock('../../src/db', () => ({ getPool: () => ({ query: mockQuery }) }));

vi.mock('../../src/services/audioStorageService', () => ({
  storeAudioFile: vi.fn().mockResolvedValue({ audioUrl: 'https://r2.example.com/s.mp3', durationSec: 210 }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      promises: {
        mkdtemp: vi.fn().mockResolvedValue('/tmp/playgen-ytdl-test'),
        readdir: vi.fn().mockResolvedValue(['abc123.mp3']),
        rm: vi.fn().mockResolvedValue(undefined),
      },
    },
    promises: {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/playgen-ytdl-test'),
      readdir: vi.fn().mockResolvedValue(['abc123.mp3']),
      rm: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// ─── buildYtDlpBotArgs (pure — no I/O mocking needed) ────────────────────────

describe('buildYtDlpBotArgs', () => {
  beforeEach(() => {
    delete process.env.YT_DLP_COOKIES_FILE;
  });

  it('always includes ios,android player clients', async () => {
    const { buildYtDlpBotArgs } = await import('../../src/services/audioSourceService');
    const args = buildYtDlpBotArgs();
    const idx = args.indexOf('--extractor-args');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('youtube:player_client=ios,android');
  });

  it('omits --cookies when YT_DLP_COOKIES_FILE is unset', async () => {
    const { buildYtDlpBotArgs } = await import('../../src/services/audioSourceService');
    expect(buildYtDlpBotArgs()).not.toContain('--cookies');
  });

  it('includes --cookies <path> when YT_DLP_COOKIES_FILE is set', async () => {
    process.env.YT_DLP_COOKIES_FILE = '/run/secrets/yt-cookies.txt';
    const { buildYtDlpBotArgs } = await import('../../src/services/audioSourceService');
    const args = buildYtDlpBotArgs();
    const idx = args.indexOf('--cookies');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/run/secrets/yt-cookies.txt');
  });
});

// ─── sourceFromYouTube — integration with yt-dlp args ────────────────────────

describe('sourceFromYouTube — yt-dlp argument construction', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
    mockQuery.mockReset();
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockQuery.mockResolvedValue({ rows: [] });
    delete process.env.YT_DLP_COOKIES_FILE;
    delete process.env.YT_DLP_PATH;
  });

  function capturedArgs(): string[] {
    const call = mockExecFileAsync.mock.calls[0];
    return call ? (call[1] as string[]) : [];
  }

  it('searches using "artist - title" format', async () => {
    const { sourceFromYouTube } = await import('../../src/services/audioSourceService');
    await sourceFromYouTube('song-1', 'station-1', 'Bohemian Rhapsody', 'Queen');

    expect(capturedArgs()[0]).toBe('ytsearch1:Queen - Bohemian Rhapsody');
  });

  it('includes bot-detection bypass args from buildYtDlpBotArgs', async () => {
    const { sourceFromYouTube, buildYtDlpBotArgs } = await import('../../src/services/audioSourceService');
    await sourceFromYouTube('song-1', 'station-1', 'Test Song', 'Test Artist');

    const args = capturedArgs();
    for (const botArg of buildYtDlpBotArgs()) {
      expect(args).toContain(botArg);
    }
  });
});
