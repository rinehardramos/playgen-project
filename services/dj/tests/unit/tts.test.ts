import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      audio: {
        speech: {
          create: vi.fn().mockResolvedValue({
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
          }),
        },
      },
    })),
  };
});

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
import { ElevenLabsTtsAdapter } from '../../src/adapters/tts/elevenlabs';

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
  });
});
