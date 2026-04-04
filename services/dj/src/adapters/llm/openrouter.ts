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
  /** Override the OpenRouter API key (e.g. read from station_settings). */
  apiKey?: string;
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
): Promise<string> {
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
  return text.trim();
}
