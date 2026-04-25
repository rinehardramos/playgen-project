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

// Preset voices available in Mistral Voxtral — IDs are UUIDs from GET /v1/audio/voices
export const MISTRAL_TTS_VOICES = [
  { id: 'en_paul_cheerful',  uuid: '01d985cd-5e0c-4457-bfd8-80ba31a5bc03', name: 'Paul - Cheerful (en-US)',  provider: 'mistral' as const },
  { id: 'en_paul_excited',   uuid: '5940190b-f58a-4c3e-8264-a40d63fd6883', name: 'Paul - Excited (en-US)',   provider: 'mistral' as const },
  { id: 'en_paul_confident', uuid: '98559b22-62b5-4a64-a7cd-fc78ca41faa8', name: 'Paul - Confident (en-US)', provider: 'mistral' as const },
  { id: 'en_paul_happy',     uuid: '1024d823-a11e-43ee-bf3d-d440dccc0577', name: 'Paul - Happy (en-US)',     provider: 'mistral' as const },
  { id: 'en_paul_neutral',   uuid: 'c69964a6-ab8b-4f8a-9465-ec0925096ec8', name: 'Paul - Neutral (en-US)',   provider: 'mistral' as const },
  { id: 'en_paul_sad',       uuid: '530e2e20-58e2-45d8-b0a5-4594f4915944', name: 'Paul - Sad (en-US)',       provider: 'mistral' as const },
  { id: 'en_paul_frustrated',uuid: '1f017bcb-02e5-460d-989b-db065c0c6122', name: 'Paul - Frustrated (en-US)',provider: 'mistral' as const },
  { id: 'en_paul_angry',     uuid: 'cb891218-482c-4392-9878-91e8d999d57a', name: 'Paul - Angry (en-US)',     provider: 'mistral' as const },
  { id: 'gb_oliver_neutral', uuid: 'e3596645-b1af-469e-b857-f18ddedc7652', name: 'Oliver - Neutral (en-GB)', provider: 'mistral' as const },
  { id: 'gb_jane_sarcasm',   uuid: 'a3e41ea8-020b-44c0-8d8b-f6cc03524e31', name: 'Jane - Sarcasm (en-GB)',   provider: 'mistral' as const },
];

// Resolve a voice_id (slug or UUID) to the UUID expected by the Mistral API
function resolveVoiceUuid(voiceId: string): string {
  // If already a UUID, pass through
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(voiceId)) {
    return voiceId;
  }
  // Legacy slug mapping
  const legacyMap: Record<string, string> = {
    energetic_female: 'gb_jane_sarcasm',
    energetic_male:   'en_paul_excited',
    cheerful_female:  'gb_jane_sarcasm',
    casual_male:      'en_paul_cheerful',
    casual_female:    'gb_jane_sarcasm',
    neutral_male:     'en_paul_neutral',
    neutral_female:   'en_paul_neutral',
    calm_male:        'en_paul_neutral',
    calm_female:      'en_paul_neutral',
  };
  const slug = legacyMap[voiceId] ?? voiceId;
  return MISTRAL_TTS_VOICES.find((v) => v.id === slug)?.uuid ?? slug;
}

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

    const voice = resolveVoiceUuid(opts.voice_id || 'en_paul_neutral');
    console.log(`[mistral-tts] voice_id=${opts.voice_id} → uuid=${voice}`);

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
