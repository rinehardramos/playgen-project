/**
 * LLM dispatch entry point.
 *
 * LLM_BACKEND (env var) selects the generation mode:
 *
 *   claude-code (default) — spawns `claude -p` CLI; uses local subscription auth.
 *                           Only works where the claude binary is installed.
 *
 *   openrouter            — calls OpenRouter; automatically falls back to Gemini
 *                           Flash on 402 / 429 if GEMINI_API_KEY is set.
 *
 * LLM_PROVIDER is still respected within the openrouter backend to allow
 * per-station provider overrides (openai, anthropic, gemini, mistral).
 */
import { config } from '../../config.js';
import type { LlmMessage, LlmOptions, LlmResult } from './openrouter.js';
import { llmComplete as openRouterLlmComplete } from './openrouter.js';
import { openAiLlmComplete } from './openai.js';
import { anthropicLlmComplete } from './anthropic.js';
import { geminiLlmComplete } from './gemini.js';
import { claudeCodeLlmComplete } from './claude-code.js';

export type LlmProvider = 'openrouter' | 'openai' | 'anthropic' | 'gemini';

export type { LlmMessage, LlmOptions, LlmResult };

/** True for HTTP status codes that indicate exhausted quota — worth retrying another provider. */
function isQuotaError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('402') || msg.includes('429') || msg.includes('insufficient credits')
    || msg.includes('rate limit') || msg.includes('quota');
}

/** Call OpenRouter; on quota error fall back to Gemini Flash if GEMINI_API_KEY is set. */
async function openRouterWithGeminiFallback(
  messages: LlmMessage[],
  options: LlmOptions,
): Promise<LlmResult> {
  try {
    return await openRouterLlmComplete(messages, options);
  } catch (err) {
    const geminiKey = options.apiKey && options.provider === 'gemini'
      ? options.apiKey
      : config.llm.geminiApiKey;

    if (isQuotaError(err) && geminiKey) {
      console.warn(
        `[llm] OpenRouter quota error — falling back to Gemini Flash: ${(err as Error).message}`,
      );
      return geminiLlmComplete(messages, { ...options, apiKey: geminiKey, model: 'gemini-3-flash-preview' });
    }
    throw err;
  }
}

export async function llmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<LlmResult> {
  // ── Claude Code backend (subscription) ──────────────────────────────────
  if (config.llm.backend === 'claude-code') {
    return claudeCodeLlmComplete(messages, options);
  }

  // ── OpenRouter backend (with Gemini fallback) ────────────────────────────
  const provider = (options.provider ?? config.llm.provider) as LlmProvider;
  switch (provider) {
    case 'openai':     return openAiLlmComplete(messages, options);
    case 'anthropic':  return anthropicLlmComplete(messages, options);
    case 'gemini':     return geminiLlmComplete(messages, options);
    default:           return openRouterWithGeminiFallback(messages, options);
  }
}
