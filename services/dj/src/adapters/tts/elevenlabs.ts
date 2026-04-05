import { config } from '../../config.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

export interface ElevenLabsVoice {
  id: string;
  name: string;
  provider: 'elevenlabs';
}

// Fallback list when the ElevenLabs API is unavailable or no key is configured
const FALLBACK_VOICES: ElevenLabsVoice[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', provider: 'elevenlabs' },
  { id: 'AZnzlk1XjtKozAtGqeoR', name: 'Nicole', provider: 'elevenlabs' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', provider: 'elevenlabs' },
  { id: 'MF3mGyEYCl7XYW7Lecd_', name: 'Elli', provider: 'elevenlabs' },
  { id: 'D38z5RcWu1voky8WS1ja', name: 'Fin', provider: 'elevenlabs' },
  { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', provider: 'elevenlabs' },
];

export class ElevenLabsTtsAdapter implements TtsAdapter {
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey ?? config.tts.elevenlabsApiKey;
    this.model = model ?? 'eleven_monolingual_v1';
    if (!this.apiKey) throw new Error('ELEVENLABS_API_KEY is required for ElevenLabs TTS');
  }

  async generate(opts: TtsOptions): Promise<TtsResult> {
    const response = await fetch(`${this.baseUrl}/text-to-speech/${opts.voice_id}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: opts.model ?? this.model,
        voice_settings: {
          stability: opts.stability ?? 0.5,
          similarity_boost: opts.similarity_boost ?? 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${errBody}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Estimate duration from file size (128kbps MP3)
    const duration_sec = Math.round((buffer.length / (128000 / 8)) * 10) / 10;

    return { audio_data: buffer, duration_sec };
  }

  /** Fetch available voices from the ElevenLabs API. Falls back to a curated list on error. */
  async listVoices(): Promise<ElevenLabsVoice[]> {
    try {
      const response = await fetch(`${this.baseUrl}/voices`, {
        headers: { 'xi-api-key': this.apiKey },
      });
      if (!response.ok) return FALLBACK_VOICES;
      const data = await response.json() as { voices?: Array<{ voice_id: string; name: string }> };
      if (!Array.isArray(data.voices)) return FALLBACK_VOICES;
      return data.voices.map(v => ({ id: v.voice_id, name: v.name, provider: 'elevenlabs' as const }));
    } catch {
      return FALLBACK_VOICES;
    }
  }
}

/** List ElevenLabs voices using the provided API key, with fallback to curated list. */
export async function listElevenLabsVoices(apiKey?: string): Promise<ElevenLabsVoice[]> {
  const key = apiKey ?? config.tts.elevenlabsApiKey;
  if (!key) return FALLBACK_VOICES;
  const adapter = new ElevenLabsTtsAdapter(key);
  return adapter.listVoices();
}
