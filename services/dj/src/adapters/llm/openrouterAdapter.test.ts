import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterAdapter } from './openrouterAdapter';
import OpenAI from 'openai';

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
      models: {
        list: vi.fn(),
      },
    })),
  };
});

describe('OpenRouterAdapter', () => {
  let adapter: OpenRouterAdapter;
  let mockOpenAI: any;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenRouterAdapter({
      apiKey: 'test-key',
      defaultModel: 'test-model',
    });
    mockOpenAI = (OpenAI as any).mock.results[0].value;
  });

  it('should call OpenAI chat.completions.create with correct params', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'Generated text' } }],
      model: 'test-model',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const response = await adapter.generateText({
      prompt: 'Hello',
      systemPrompt: 'Be a DJ',
      temperature: 0.7,
    });

    expect(response.text).toBe('Generated text');
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'Be a DJ' },
        { role: 'user', content: 'Hello' },
      ],
      temperature: 0.7,
      max_tokens: undefined,
    });
  });

  it('should use specified model if provided', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'GPT-4 response' } }],
      model: 'openai/gpt-4o',
    });

    const response = await adapter.generateText({
      prompt: 'Test',
      model: 'openai/gpt-4o',
    });

    expect(response.model).toBe('openai/gpt-4o');
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-4o' })
    );
  });

  it('should list models from OpenAI API', async () => {
    mockOpenAI.models.list.mockResolvedValue({
      data: [{ id: 'model-1' }, { id: 'model-2' }],
    });

    const models = await adapter.listModels();
    expect(models).toEqual(['model-1', 'model-2']);
  });
});
