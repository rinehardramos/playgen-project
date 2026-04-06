/**
 * LLM dispatch entry point — routes to the correct provider adapter.
 */
import { config } from '../../config.js';
import type { LlmMessage, LlmOptions, LlmResult } from './openrouter.js';
import { llmComplete as openRouterLlmComplete } from './openrouter.js';
import { openAiLlmComplete } from './openai.js';
import { anthropicLlmComplete } from './anthropic.js';
import { geminiLlmComplete } from './gemini.js';

export type LlmProvider = 'openrouter' | 'openai' | 'anthropic' | 'gemini';

export type { LlmMessage, LlmOptions, LlmResult };

export async function llmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<LlmResult> {
  const provider = (options.provider ?? config.llm.provider) as LlmProvider;
  switch (provider) {
    case 'openai':     return openAiLlmComplete(messages, options);
    case 'anthropic':  return anthropicLlmComplete(messages, options);
    case 'gemini':     return geminiLlmComplete(messages, options);
    default:           return openRouterLlmComplete(messages, options);
  }
}
