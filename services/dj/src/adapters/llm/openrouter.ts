import OpenAI from 'openai';
import { config } from '../../config.js';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Override the API key (e.g. read from station_settings). */
  apiKey?: string;
  /** LLM provider: 'openrouter' (default) | 'openai' */
  provider?: string;
}

/** Token usage returned alongside the generated text. */
export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Return value of llmComplete — text plus optional token usage. */
export interface LlmResult {
  text: string;
  usage?: LlmUsage;
}

let defaultClient: OpenAI | null = null;

function getClient(apiKey?: string): OpenAI {
  // If a per-station API key is provided, create a one-off client; otherwise share the default.
  if (apiKey) {
    return new OpenAI({
      baseURL: config.openRouter.baseUrl,
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': config.openRouter.siteUrl,
        'X-Title': config.openRouter.siteName,
      },
    });
  }
  if (!defaultClient) {
    defaultClient = new OpenAI({
      baseURL: config.openRouter.baseUrl,
      apiKey: config.openRouter.apiKey,
      defaultHeaders: {
        'HTTP-Referer': config.openRouter.siteUrl,
        'X-Title': config.openRouter.siteName,
      },
    });
  }
  return defaultClient;
}

export async function llmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<LlmResult> {
  // Dispatch to the appropriate provider
  const provider = options.provider ?? config.llm.provider;
  if (provider === 'openai') {
    const { openAiLlmComplete } = await import('./openai.js');
    return openAiLlmComplete(messages, options);
  }
  if (provider === 'anthropic') {
    const { anthropicLlmComplete } = await import('./anthropic.js');
    return anthropicLlmComplete(messages, options);
  }
  if (provider === 'gemini') {
    const { geminiLlmComplete } = await import('./gemini.js');
    return geminiLlmComplete(messages, options);
  }
  if (provider === 'mistral') {
    const { mistralLlmComplete } = await import('./mistral.js');
    return mistralLlmComplete(messages, options);
  }

  const c = getClient(options.apiKey);
  const model = options.model ?? config.openRouter.defaultModel;

  const response = await c.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? 512,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('LLM returned empty response');

  const usage: LlmUsage | undefined = response.usage
    ? {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
      }
    : undefined;

  return { text: text.trim(), usage };
}
