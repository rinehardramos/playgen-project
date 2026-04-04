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
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: config.openRouter.baseUrl,
      apiKey: config.openRouter.apiKey,
      defaultHeaders: {
        'HTTP-Referer': config.openRouter.siteUrl,
        'X-Title': config.openRouter.siteName,
      },
    });
  }
  return client;
}

export async function llmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<string> {
  const c = getClient();
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
