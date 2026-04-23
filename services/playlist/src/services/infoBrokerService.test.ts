/**
 * Unit tests for infoBrokerService.requestAudioSourcing.
 *
 * fetch is mocked globally — no network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STATION_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

const SONGS = [
  { song_id: 'cccccccc-0000-0000-0000-000000000003', title: 'Blue Moon', artist: 'Ella Fitzgerald' },
];

// We import the module under test AFTER setting env vars so the module-level
// consts pick up the test values.
const ENV_BACKUP: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    ENV_BACKUP[k] = process.env[k];
    process.env[k] = v;
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('requestAudioSourcing', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
    vi.resetModules();
  });

  it('does NOT call fetch when songs array is empty', async () => {
    setEnv({ INFO_BROKER_URL: 'https://broker.example.com', INFO_BROKER_API_KEY: 'key123' });
    const { requestAudioSourcing } = await import('./infoBrokerService');
    await requestAudioSourcing(STATION_ID, []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does NOT call fetch when INFO_BROKER_URL is missing', async () => {
    setEnv({ INFO_BROKER_URL: '', INFO_BROKER_API_KEY: 'key123' });
    const { requestAudioSourcing } = await import('./infoBrokerService');
    await requestAudioSourcing(STATION_ID, SONGS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does NOT call fetch when INFO_BROKER_API_KEY is missing', async () => {
    setEnv({ INFO_BROKER_URL: 'https://broker.example.com', INFO_BROKER_API_KEY: '' });
    const { requestAudioSourcing } = await import('./infoBrokerService');
    await requestAudioSourcing(STATION_ID, SONGS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls fetch with correct URL, headers, and body when all inputs are valid', async () => {
    setEnv({
      INFO_BROKER_URL: 'https://broker.example.com',
      INFO_BROKER_API_KEY: 'key123',
      PLAYGEN_INTERNAL_URL: 'https://api.playgen.site',
    });
    const { requestAudioSourcing } = await import('./infoBrokerService');
    await requestAudioSourcing(STATION_ID, SONGS);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://broker.example.com/v1/playlists/source-audio');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((options.headers as Record<string, string>)['X-API-Key']).toBe('key123');

    const body = JSON.parse(options.body as string);
    expect(body.station_id).toBe(STATION_ID);
    expect(body.songs).toEqual(SONGS);
    expect(body.callback_url).toBe('https://api.playgen.site/internal/songs/audio-sourced');
  });

  it('does not propagate when fetch throws (fire-and-forget)', async () => {
    setEnv({ INFO_BROKER_URL: 'https://broker.example.com', INFO_BROKER_API_KEY: 'key123' });
    fetchMock.mockRejectedValue(new Error('network failure'));
    const { requestAudioSourcing } = await import('./infoBrokerService');
    // Must not throw
    await expect(requestAudioSourcing(STATION_ID, SONGS)).resolves.toBeUndefined();
  });
});
