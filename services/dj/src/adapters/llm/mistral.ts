/**
 * Mistral LLM adapter — calls the Mistral chat completions API.
 * Docs: https://docs.mistral.ai/api/#tag/chat
 */
import type { LlmMessage, LlmOptions, LlmResult } from './openrouter.js';

export type { LlmMessage, LlmOptions };

const DEFAULT_MODEL = 'mistral-large-latest';
const BASE_URL = 'https://api.mistral.ai/v1/chat/completions';

export async function mistralLlmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<LlmResult> {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error('Mistral API key is required');

  const model = options.model || DEFAULT_MODEL;

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.8,
      max_tokens: options.maxTokens ?? 512,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mistral API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Mistral returned empty response');

  return {
    text: text.trim(),
    usage: data.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens ?? 0,
          completion_tokens: data.usage.completion_tokens ?? 0,
          total_tokens: data.usage.total_tokens ?? 0,
        }
      : undefined,
  };
}
