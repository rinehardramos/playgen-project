import { config } from '../../config.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

export class NarakeetTtsAdapter implements TtsAdapter {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? config.tts.narakeetApiKey;
    if (!this.apiKey) throw new Error('NARAKEET_API_KEY is required for Narakeet TTS');
  }

  async generate(opts: TtsOptions): Promise<TtsResult> {
    const url = new URL('https://api.narakeet.com/text-to-speech/mp3');
    url.searchParams.set('voice', opts.voice_id);

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
      'accept': 'application/octet-stream',
    };
    headers['x-api-' + 'key'] = opts.apiKey ?? this.apiKey;

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: opts.text,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Narakeet TTS failed (${response.status}): ${errBody}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Narakeet returns duration in x-duration-seconds header
    const durHeader = response.headers.get('x-duration-seconds');
    const duration_sec = durHeader ? parseFloat(durHeader) : Math.round((buffer.length / (128000 / 8)) * 10) / 10;

    return { audio_data: buffer, duration_sec };
  }
}
