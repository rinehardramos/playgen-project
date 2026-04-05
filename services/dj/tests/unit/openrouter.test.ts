import { describe, it, expect, vi } from 'vitest';

// Shared mock fn so we can assert on it across tests
const mockCreate = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'Hello, welcome to the show!' } }],
});

// Vitest 4.x: use class syntax for constructor mocks
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(class {
    chat = { completions: { create: mockCreate } };
  }),
}));

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
