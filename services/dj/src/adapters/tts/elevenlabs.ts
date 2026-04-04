import fs from 'fs/promises';
import path from 'path';
import { config } from '../../config.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

export class ElevenLabsTtsAdapter implements TtsAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor() {
    this.apiKey = config.tts.elevenlabsApiKey;
    if (!this.apiKey) {
      console.warn('ELEVENLABS_API_KEY is missing in config, station-specific key will be required');
    }
  }

  async generate(opts: TtsOptions): Promise<TtsResult> {
    const apiKey = opts.apiKey || this.apiKey;
    if (!apiKey) throw new Error('ElevenLabs API key is missing');

    const response = await fetch(`${this.baseUrl}/text-to-speech/${opts.voice_id}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${errBody}`);
    }

    await fs.mkdir(path.dirname(opts.output_path), { recursive: true });
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(opts.output_path, buffer);

    // Estimate duration from file size (128kbps MP3)
    const duration_sec = Math.round((buffer.length / (128000 / 8)) * 10) / 10;

    return { audio_path: opts.output_path, duration_sec };
  }
}
