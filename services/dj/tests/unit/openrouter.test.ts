import { describe, it, expect, vi } from 'vitest';

// Mock the openai module before importing the adapter
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Hello, welcome to the show!' } }],
          }),
        },
      },
    })),
  };
});

// Must import after mocking
import { llmComplete } from '../../src/adapters/llm/openrouter';

describe('llmComplete', () => {
  it('returns trimmed text from LLM response', async () => {
    const result = await llmComplete([
      { role: 'system', content: 'You are Alex, a radio DJ.' },
      { role: 'user', content: 'Introduce the next song.' },
    ]);
    expect(result).toBe('Hello, welcome to the show!');
  });

  it('accepts optional model and temperature', async () => {
    const result = await llmComplete(
      [{ role: 'user', content: 'test' }],
      { model: 'openai/gpt-4o', temperature: 0.5 },
    );
    expect(result).toBeDefined();
  });
});
