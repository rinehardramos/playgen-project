import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
  config: {
    tts: {
      googleApiKey: 'test-google-key',
      provider: 'google',
    },
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GoogleTtsAdapter, GOOGLE_TTS_VOICES } from '../../src/adapters/tts/google';

describe('GoogleTtsAdapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('synthesizes speech and returns a Buffer', async () => {
    const fakeAudio = Buffer.from('fake-mp3-data').toString('base64');
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ audioContent: fakeAudio }),
    });

    const adapter = new GoogleTtsAdapter('test-key');
    const result = await adapter.generate({ voice_id: 'en-US-Neural2-A', text: 'Hello radio!' });

    expect(result.audio_data).toBeInstanceOf(Buffer);
    expect(result.audio_data.length).toBeGreaterThan(0);
    expect(result.duration_sec).toBeGreaterThan(0);
  });

  it('sends correct voice name and language code', async () => {
    const fakeAudio = Buffer.from('audio').toString('base64');
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ audioContent: fakeAudio }),
    });

    const adapter = new GoogleTtsAdapter('test-key');
    await adapter.generate({ voice_id: 'en-GB-Neural2-B', text: 'Test' });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('texttospeech.googleapis.com');
    const body = JSON.parse(init.body);
    expect(body.voice.name).toBe('en-GB-Neural2-B');
    expect(body.voice.languageCode).toBe('en-GB');
    expect(body.audioConfig.audioEncoding).toBe('MP3');
  });

  it('includes API key in URL', async () => {
    const fakeAudio = Buffer.from('a').toString('base64');
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ audioContent: fakeAudio }),
    });

    const adapter = new GoogleTtsAdapter('my-api-key');
    await adapter.generate({ voice_id: 'en-US-Wavenet-A', text: 'Test' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('key=my-api-key');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue('API key invalid'),
    });

    const adapter = new GoogleTtsAdapter('bad-key');
    await expect(
      adapter.generate({ voice_id: 'en-US-Neural2-A', text: 'Hello' }),
    ).rejects.toThrow('Google TTS failed (403): API key invalid');
  });

  it('listVoices returns curated Google voice list', async () => {
    const adapter = new GoogleTtsAdapter();
    const voices = await adapter.listVoices();
    expect(voices.length).toBeGreaterThan(0);
    expect(voices[0].provider).toBe('google');
    expect(voices[0].id).toContain('en-');
  });

  it('GOOGLE_TTS_VOICES exports curated list with provider=google', () => {
    expect(GOOGLE_TTS_VOICES.length).toBeGreaterThan(0);
    expect(GOOGLE_TTS_VOICES.every(v => v.provider === 'google')).toBe(true);
  });
});
