import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../../config.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

export class OpenAiTtsAdapter implements TtsAdapter {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.tts.openaiApiKey });
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

export function getTtsAdapter(): TtsAdapter {
  if (config.tts.provider === 'openai') return new OpenAiTtsAdapter();
  if (config.tts.provider === 'elevenlabs') {
    // Dynamic import to avoid loading ElevenLabs when not needed
    const { ElevenLabsTtsAdapter } = require('./elevenlabs.js');
    return new ElevenLabsTtsAdapter();
  }
  throw new Error(`TTS provider "${config.tts.provider}" not yet implemented`);
}
