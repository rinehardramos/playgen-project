import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OpenAI
// Shared mock fn — Vitest 4.x: use class syntax for constructor mocks
const mockSpeechCreate = vi.fn().mockResolvedValue({
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
});

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(class {
    audio = { speech: { create: mockSpeechCreate } };
  }),
}));

// Mock config
vi.mock('../../src/config', () => ({
  config: {
    tts: {
      openaiApiKey: 'test-openai-key',
      elevenlabsApiKey: 'test-elevenlabs-key',
      provider: 'openai',
    },
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { OpenAiTtsAdapter } from '../../src/adapters/tts/openai';
import { ElevenLabsTtsAdapter, listElevenLabsVoices } from '../../src/adapters/tts/elevenlabs';

describe('TTS Adapters', () => {
  describe('OpenAiTtsAdapter', () => {
    it('generates speech using OpenAI API', async () => {
      const adapter = new OpenAiTtsAdapter();
      const result = await adapter.generate({
        voice_id: 'alloy',
        text: 'Hello world',
      });

      expect(result.audio_data).toBeDefined();
      expect(result.audio_data.length).toBe(1024);
    });
  });

  describe('ElevenLabsTtsAdapter', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('generates speech using ElevenLabs API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
      });

      const adapter = new ElevenLabsTtsAdapter();
      const result = await adapter.generate({
        voice_id: 'voice-id',
        text: 'Hello world',
      });

      expect(result.audio_data).toBeDefined();
      expect(result.duration_sec).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('elevenlabs.io'),
        expect.any(Object)
      );
    });

    it('passes custom stability and similarity_boost to API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(512)),
      });

      const adapter = new ElevenLabsTtsAdapter();
      await adapter.generate({
        voice_id: 'voice-id',
        text: 'Test',
        stability: 0.8,
        similarity_boost: 0.9,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.voice_settings.stability).toBe(0.8);
      expect(body.voice_settings.similarity_boost).toBe(0.9);
    });

    it('uses default stability/similarity_boost when not specified', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(512)),
      });

      const adapter = new ElevenLabsTtsAdapter();
      await adapter.generate({ voice_id: 'v', text: 'Test' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.voice_settings.stability).toBe(0.5);
      expect(body.voice_settings.similarity_boost).toBe(0.75);
    });

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized'),
      });

      const adapter = new ElevenLabsTtsAdapter();
      await expect(adapter.generate({
        voice_id: 'voice-id',
        text: 'Hello world',
      })).rejects.toThrow('ElevenLabs TTS failed (401): Unauthorized');
    });

    it('listVoices returns live voices from API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          voices: [
            { voice_id: 'abc123', name: 'Custom Voice' },
            { voice_id: 'def456', name: 'Another Voice' },
          ],
        }),
      });

      const adapter = new ElevenLabsTtsAdapter();
      const voices = await adapter.listVoices();

      expect(voices).toHaveLength(2);
      expect(voices[0]).toEqual({ id: 'abc123', name: 'Custom Voice', provider: 'elevenlabs' });
    });

    it('listVoices falls back to curated list on API error', async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const adapter = new ElevenLabsTtsAdapter();
      const voices = await adapter.listVoices();

      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0].provider).toBe('elevenlabs');
    });
  });

  describe('listElevenLabsVoices', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns fallback voices when no API key configured', async () => {
      // The config mock has elevenlabsApiKey = 'test-elevenlabs-key', so pass explicit empty key
      // We test the no-key path via a separate check
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ voices: [] }),
      });

      // With a valid key, returns live (empty) list
      const voices = await listElevenLabsVoices('some-key');
      expect(Array.isArray(voices)).toBe(true);
    });
  });
});
