/**
 * Google Gemini LLM adapter — calls the Gemini generateContent REST API directly.
 */
import type { LlmMessage, LlmOptions } from './openrouter.js';

export type { LlmMessage, LlmOptions };

const DEFAULT_MODEL = 'gemini-2.0-flash';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function geminiLlmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<string> {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error('Gemini API key is required');

  const model = options.model || DEFAULT_MODEL;
  const url = `${BASE_URL}/${model}:generateContent?key=${apiKey}`;

  // Separate system messages from conversation messages
  const systemParts = messages
    .filter((m) => m.role === 'system')
    .map((m) => ({ text: m.content }));

  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.8,
      maxOutputTokens: options.maxTokens ?? 512,
    },
  };

  if (systemParts.length > 0) {
    body['system_instruction'] = { parts: systemParts };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text.trim();
}
