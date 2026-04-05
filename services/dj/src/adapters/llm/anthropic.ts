/**
 * Anthropic direct LLM adapter — calls api.anthropic.com using the Anthropic SDK.
 * Follows the same interface as the OpenRouter/OpenAI adapters so callers can swap providers.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import type { LlmMessage, LlmOptions } from './openrouter.js';

export type { LlmMessage, LlmOptions };

let defaultClient: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (apiKey) {
    return new Anthropic({ apiKey });
  }
  if (!defaultClient) {
    defaultClient = new Anthropic({ apiKey: config.llm.anthropicApiKey });
  }
  return defaultClient;
}

const DEFAULT_MODEL = 'claude-3-5-haiku-20241022';

export async function anthropicLlmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<string> {
  const c = getClient(options.apiKey);
  const model = options.model ?? DEFAULT_MODEL;

  // Anthropic API separates system prompt from user/assistant messages
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const systemPrompt = systemMessages.map((m) => m.content).join('\n');

  const response = await c.messages.create({
    model,
    max_tokens: options.maxTokens ?? 512,
    temperature: options.temperature ?? 0.8,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: nonSystemMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  });

  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('Anthropic LLM returned empty response');
  return block.text.trim();
}
