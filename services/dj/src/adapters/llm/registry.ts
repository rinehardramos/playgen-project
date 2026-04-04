import { LLMAdapter } from './types';
import { OpenRouterAdapter } from './openrouterAdapter';
import { config } from '../../config';

const adapters: Record<string, LLMAdapter> = {};

export function getLLMAdapter(provider?: string): LLMAdapter {
  const p = provider || config.llm.provider;

  if (adapters[p]) {
    return adapters[p];
  }

  if (p === 'openrouter') {
    if (!config.llm.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured');
    }
    adapters[p] = new OpenRouterAdapter({
      apiKey: config.llm.apiKey,
      defaultModel: config.llm.model,
    });
    return adapters[p];
  }

  throw new Error(`Unsupported LLM provider: ${p}`);
}

export function registerLLMAdapter(name: string, adapter: LLMAdapter) {
  adapters[name] = adapter;
}
