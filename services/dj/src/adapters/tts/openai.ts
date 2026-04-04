import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../../config.js';
import { ElevenLabsTtsAdapter } from './elevenlabs.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

export class OpenAiTtsAdapter implements TtsAdapter {
  private defaultClient: OpenAI;

  constructor() {
    this.defaultClient = new OpenAI({ apiKey: config.tts.openaiApiKey });
  }

  async generate(opts: TtsOptions): Promise<TtsResult> {
    const client = opts.apiKey 
      ? new OpenAI({ apiKey: opts.apiKey })
      : this.defaultClient;

    const response = await client.audio.speech.create({
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

export function getTtsAdapter(): TtsAdapter {
  if (config.tts.provider === 'openai') return new OpenAiTtsAdapter();
  if (config.tts.provider === 'elevenlabs') {
    return new ElevenLabsTtsAdapter();
  }
  throw new Error(`TTS provider "${config.tts.provider}" not yet implemented`);
}
