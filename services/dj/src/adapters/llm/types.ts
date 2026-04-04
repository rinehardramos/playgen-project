export interface LLMRequest {
  model?: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMAdapter {
  generateText(request: LLMRequest): Promise<LLMResponse>;
  listModels(): Promise<string[]>;
}
