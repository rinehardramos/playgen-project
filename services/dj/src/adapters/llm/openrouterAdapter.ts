import OpenAI from 'openai';
import { LLMAdapter, LLMRequest, LLMResponse } from './types';

export interface OpenRouterConfig {
  apiKey: string;
  defaultModel: string;
  baseUrl?: string;
  siteUrl?: string;
  siteName?: string;
}

export class OpenRouterAdapter implements LLMAdapter {
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: OpenRouterConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': config.siteUrl || 'https://playgen.site',
        'X-Title': config.siteName || 'PlayGen AI DJ',
      },
    });
    this.defaultModel = config.defaultModel;
  }

  async generateText(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.defaultModel;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    messages.push({ role: 'user', content: request.prompt });

    const response = await this.client.chat.completions.create({
      model,
      messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    });

    const choice = response.choices[0];
    if (!choice || !choice.message?.content) {
      throw new Error('LLM returned an empty response');
    }

    return {
      text: choice.message.content,
      model: response.model,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    };
  }

  async listModels(): Promise<string[]> {
    const response = await this.client.models.list();
    return response.data.map((m) => m.id);
  }
}
