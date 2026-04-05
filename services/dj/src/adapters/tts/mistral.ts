/**
 * Mistral Voxtral TTS adapter.
 * Uses the Mistral Audio Speech API (voxtral-mini-tts-2603).
 * Returns MP3 audio decoded from base64.
 *
 * Docs: https://docs.mistral.ai/capabilities/audio/
 */
import { config } from '../../config.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

const MISTRAL_TTS_URL = 'https://api.mistral.ai/v1/audio/speech';
const DEFAULT_MODEL = 'voxtral-mini-tts-2603';

// Preset voices available in Mistral Voxtral
export const MISTRAL_TTS_VOICES = [
  { id: 'casual_male', name: 'Casual Male', provider: 'mistral' as const },
  { id: 'casual_female', name: 'Casual Female', provider: 'mistral' as const },
  { id: 'cheerful_female', name: 'Cheerful Female', provider: 'mistral' as const },
  { id: 'neutral_male', name: 'Neutral Male', provider: 'mistral' as const },
  { id: 'neutral_female', name: 'Neutral Female', provider: 'mistral' as const },
  { id: 'energetic_male', name: 'Energetic Male', provider: 'mistral' as const },
  { id: 'energetic_female', name: 'Energetic Female', provider: 'mistral' as const },
  { id: 'calm_male', name: 'Calm Male', provider: 'mistral' as const },
  { id: 'calm_female', name: 'Calm Female', provider: 'mistral' as const },
];

export class MistralTtsAdapter implements TtsAdapter {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey ?? config.tts.mistralApiKey;
    this.model = model ?? DEFAULT_MODEL;
  }

  async generate(opts: TtsOptions): Promise<TtsResult> {
    const apiKey = opts.apiKey ?? this.apiKey;
    if (!apiKey) throw new Error('Mistral API key is required for TTS');

    const voice = opts.voice_id || 'neutral_male';

    const res = await fetch(MISTRAL_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: opts.text,
        voice,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Mistral TTS failed (${res.status}): ${errText}`);
    }

    const data = await res.json() as { audio_data?: string };
    if (!data.audio_data) {
      throw new Error('Mistral TTS returned no audio data');
    }

    const audio_data = Buffer.from(data.audio_data, 'base64');

    // Estimate duration: MP3 at 128kbps ≈ 16000 bytes/sec
    const duration_sec = audio_data.length / 16000;

    return { audio_data, duration_sec };
  }

  listVoices() {
    return Promise.resolve(MISTRAL_TTS_VOICES);
  }
}
