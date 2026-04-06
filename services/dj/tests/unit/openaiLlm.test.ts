import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'Hello from GPT-4o!' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(class {
    chat = { completions: { create: mockCreate } };
  }),
}));

vi.mock('../../src/config', () => ({
  config: {
    llm: { provider: 'openai', openaiApiKey: 'test-openai-key' },
    openRouter: { defaultModel: 'anthropic/claude-sonnet-4-5' },
  },
}));

import { openAiLlmComplete } from '../../src/adapters/llm/openai';

describe('OpenAiLlmAdapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns trimmed text from GPT-4o response', async () => {
    const result = await openAiLlmComplete([
      { role: 'system', content: 'You are Alex, a radio DJ.' },
      { role: 'user', content: 'Introduce the next song.' },
    ]);
    expect(result.text).toBe('Hello from GPT-4o!');
  });

  it('returns token usage when available', async () => {
    const result = await openAiLlmComplete([{ role: 'user', content: 'test' }]);
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it('returns undefined usage when not provided', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello!' } }],
      usage: undefined,
    });
    const result = await openAiLlmComplete([{ role: 'user', content: 'test' }]);
    expect(result.usage).toBeUndefined();
  });

  it('uses gpt-4o-mini as default model', async () => {
    await openAiLlmComplete([{ role: 'user', content: 'test' }]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' }),
    );
  });

  it('accepts optional model and temperature', async () => {
    await openAiLlmComplete(
      [{ role: 'user', content: 'test' }],
      { model: 'gpt-4o', temperature: 0.3 },
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', temperature: 0.3 }),
    );
  });

  it('throws on empty LLM response', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '' } }] });
    await expect(
      openAiLlmComplete([{ role: 'user', content: 'test' }]),
    ).rejects.toThrow('OpenAI LLM returned empty response');
  });
});
