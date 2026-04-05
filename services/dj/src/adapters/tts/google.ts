/**
 * Google Cloud Text-to-Speech adapter.
 * Uses the REST API directly (no SDK dependency needed).
 * Docs: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
 */
import { config } from '../../config.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

// Curated list of high-quality Google TTS voices
export const GOOGLE_TTS_VOICES = [
  { id: 'en-US-Neural2-A', name: 'Neural2 A (US Male)', provider: 'google' as const },
  { id: 'en-US-Neural2-C', name: 'Neural2 C (US Female)', provider: 'google' as const },
  { id: 'en-US-Neural2-D', name: 'Neural2 D (US Male)', provider: 'google' as const },
  { id: 'en-US-Neural2-F', name: 'Neural2 F (US Female)', provider: 'google' as const },
  { id: 'en-US-Wavenet-A', name: 'WaveNet A (US Male)', provider: 'google' as const },
  { id: 'en-US-Wavenet-C', name: 'WaveNet C (US Female)', provider: 'google' as const },
  { id: 'en-US-Wavenet-D', name: 'WaveNet D (US Male)', provider: 'google' as const },
  { id: 'en-US-Wavenet-F', name: 'WaveNet F (US Female)', provider: 'google' as const },
  { id: 'en-GB-Neural2-A', name: 'Neural2 A (UK Female)', provider: 'google' as const },
  { id: 'en-GB-Neural2-B', name: 'Neural2 B (UK Male)', provider: 'google' as const },
  { id: 'en-AU-Neural2-A', name: 'Neural2 A (AU Female)', provider: 'google' as const },
  { id: 'en-AU-Neural2-B', name: 'Neural2 B (AU Male)', provider: 'google' as const },
];

export class GoogleTtsAdapter implements TtsAdapter {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? config.tts.googleApiKey;
  }

  async generate(opts: TtsOptions): Promise<TtsResult> {
    // Voice IDs follow BCP-47 convention: e.g. "en-US-Neural2-A"
    // Extract language code from the voice name prefix
    const parts = opts.voice_id.split('-');
    const languageCode = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'en-US';

    const body = {
      input: { text: opts.text },
      voice: {
        languageCode,
        name: opts.voice_id,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0,
      },
    };

    const res = await fetch(`${GOOGLE_TTS_URL}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google TTS failed (${res.status}): ${errText}`);
    }

    const json = await res.json() as { audioContent: string };
    const audioData = Buffer.from(json.audioContent, 'base64');

    // Estimate duration: MP3 at 24kbps (Google default) ≈ 3000 bytes/sec
    const duration_sec = audioData.length / 3000;

    return { audio_data: audioData, duration_sec };
  }

  listVoices() {
    return Promise.resolve(GOOGLE_TTS_VOICES);
  }
}
