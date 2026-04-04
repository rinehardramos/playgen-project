import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../../config.js';
import { ElevenLabsTtsAdapter } from './elevenlabs.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

export interface TtsAdapterOverrides {
  provider?: string;
  apiKey?: string;
  voiceId?: string;
}

export class OpenAiTtsAdapter implements TtsAdapter {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? config.tts.openaiApiKey });
  }

  async generate(opts: TtsOptions): Promise<TtsResult> {
    const response = await this.client.audio.speech.create({
      model: 'tts-1',
      voice: opts.voice_id as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: opts.text,
      response_format: 'mp3',
    });

    await fs.mkdir(path.dirname(opts.output_path), { recursive: true });
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(opts.output_path, buffer);

    return { audio_path: opts.output_path, duration_sec: null };
  }
}

export function getTtsAdapter(overrides?: TtsAdapterOverrides): TtsAdapter {
  const provider = overrides?.provider ?? config.tts.provider;
  if (provider === 'openai') return new OpenAiTtsAdapter(overrides?.apiKey);
  if (provider === 'elevenlabs') {
    return new ElevenLabsTtsAdapter(overrides?.apiKey);
  }
  throw new Error(`TTS provider "${provider}" not yet implemented`);
}
