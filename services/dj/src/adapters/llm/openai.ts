/**
 * OpenAI Chat LLM adapter — calls api.openai.com directly (GPT-4o / GPT-4o-mini).
 * Follows the same interface as the OpenRouter adapter so callers can swap providers.
 */
import OpenAI from 'openai';
import { config } from '../../config.js';
import type { LlmMessage, LlmOptions, LlmResult } from './openrouter.js';

export type { LlmMessage, LlmOptions };

let defaultClient: OpenAI | null = null;

function getClient(apiKey?: string): OpenAI {
  if (apiKey) {
    return new OpenAI({ apiKey });
  }
  if (!defaultClient) {
    defaultClient = new OpenAI({ apiKey: config.llm.openaiApiKey });
  }
  return defaultClient;
}

const DEFAULT_MODEL = 'gpt-4o-mini';

export async function openAiLlmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<LlmResult> {
  const c = getClient(options.apiKey);
  const model = options.model ?? DEFAULT_MODEL;

  const response = await c.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? 512,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('OpenAI LLM returned empty response');

  return {
    text: text.trim(),
    usage: response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined,
  };
}
