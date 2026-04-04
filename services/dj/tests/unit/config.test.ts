import { describe, it, expect } from 'vitest';
import { config } from '../../src/config';

describe('config', () => {
  it('has default port 3007', () => {
    expect(config.port).toBe(3007);
  });

  it('has OpenRouter defaults', () => {
    expect(config.openRouter.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(config.openRouter.defaultModel).toContain('claude');
  });

  it('has TTS defaults', () => {
    expect(config.tts.provider).toBe('openai');
    expect(config.tts.defaultVoice).toBe('alloy');
  });

  it('has storage defaults', () => {
    expect(config.storage.provider).toBe('local');
    // Default depends on NODE_ENV if STORAGE_LOCAL_PATH is not set
    expect(config.storage.localPath).toBeDefined();
  });

  it('has redis defaults', () => {
    expect(config.redis.host).toBe('localhost');
    expect(config.redis.port).toBe(6379);
  });
});
