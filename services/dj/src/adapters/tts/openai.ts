import OpenAI from 'openai';
import { config } from '../../config.js';
import { ElevenLabsTtsAdapter } from './elevenlabs.js';
import { GoogleTtsAdapter } from './google.js';
import { GeminiTtsAdapter } from './gemini_tts.js';
import { MistralTtsAdapter } from './mistral.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

export interface TtsAdapterOverrides {
  provider?: string;
  apiKey?: string;
  voiceId?: string;
  model?: string;
}

export class OpenAiTtsAdapter implements TtsAdapter {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? config.tts.openaiApiKey });
  }

  async generate(opts: TtsOptions): Promise<TtsResult> {
    const response = await this.client.audio.speech.create({
      model: (opts.model ?? 'tts-1') as 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts',
      voice: opts.voice_id as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: opts.text,
      response_format: 'mp3',
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    return { audio_data: buffer, duration_sec: null };
  }
}

export function getTtsAdapter(overrides?: TtsAdapterOverrides): TtsAdapter {
  const provider = overrides?.provider ?? config.tts.provider;
  if (provider === 'openai') return new OpenAiTtsAdapter(overrides?.apiKey);
  if (provider === 'elevenlabs') return new ElevenLabsTtsAdapter(overrides?.apiKey, overrides?.model);
  if (provider === 'google') return new GoogleTtsAdapter(overrides?.apiKey);
  if (provider === 'gemini_tts') return new GeminiTtsAdapter(overrides?.apiKey, overrides?.model);
  if (provider === 'mistral') return new MistralTtsAdapter(overrides?.apiKey, overrides?.model);
  throw new Error(`TTS provider "${provider}" not yet implemented`);
}
