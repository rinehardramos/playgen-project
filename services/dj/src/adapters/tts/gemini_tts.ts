/**
 * Gemini Native TTS adapter.
 * Uses the Gemini generateContent API with responseModalities: ["AUDIO"].
 * Returns raw PCM audio (24kHz, 16-bit mono) wrapped in a WAV container.
 *
 * Supported models: gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts
 * Docs: https://ai.google.dev/gemini-api/docs/audio-generation
 */
import { config } from '../../config.js';
import type { TtsAdapter, TtsOptions, TtsResult } from './interface.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';

// 30 available prebuilt voices for Gemini TTS
export const GEMINI_TTS_VOICES = [
  { id: 'Zephyr', name: 'Zephyr (Bright)', provider: 'gemini_tts' as const },
  { id: 'Puck', name: 'Puck (Upbeat)', provider: 'gemini_tts' as const },
  { id: 'Charon', name: 'Charon (Informational)', provider: 'gemini_tts' as const },
  { id: 'Kore', name: 'Kore (Firm)', provider: 'gemini_tts' as const },
  { id: 'Fenrir', name: 'Fenrir (Excitable)', provider: 'gemini_tts' as const },
  { id: 'Leda', name: 'Leda (Youthful)', provider: 'gemini_tts' as const },
  { id: 'Orus', name: 'Orus (Firm)', provider: 'gemini_tts' as const },
  { id: 'Aoede', name: 'Aoede (Breezy)', provider: 'gemini_tts' as const },
  { id: 'Callirrhoe', name: 'Callirrhoe (Easy-going)', provider: 'gemini_tts' as const },
  { id: 'Autonoe', name: 'Autonoe (Bright)', provider: 'gemini_tts' as const },
  { id: 'Enceladus', name: 'Enceladus (Breathy)', provider: 'gemini_tts' as const },
  { id: 'Iapetus', name: 'Iapetus (Clear)', provider: 'gemini_tts' as const },
  { id: 'Umbriel', name: 'Umbriel (Easy-going)', provider: 'gemini_tts' as const },
  { id: 'Algieba', name: 'Algieba (Smooth)', provider: 'gemini_tts' as const },
  { id: 'Despina', name: 'Despina (Smooth)', provider: 'gemini_tts' as const },
  { id: 'Erinome', name: 'Erinome (Clear)', provider: 'gemini_tts' as const },
  { id: 'Algenib', name: 'Algenib (Gravelly)', provider: 'gemini_tts' as const },
  { id: 'Rasalgethi', name: 'Rasalgethi (Informational)', provider: 'gemini_tts' as const },
  { id: 'Laomedeia', name: 'Laomedeia (Upbeat)', provider: 'gemini_tts' as const },
  { id: 'Achernar', name: 'Achernar (Soft)', provider: 'gemini_tts' as const },
  { id: 'Alnilam', name: 'Alnilam (Firm)', provider: 'gemini_tts' as const },
  { id: 'Schedar', name: 'Schedar (Even)', provider: 'gemini_tts' as const },
  { id: 'Gacrux', name: 'Gacrux (Mature)', provider: 'gemini_tts' as const },
  { id: 'Pulcherrima', name: 'Pulcherrima (Forward)', provider: 'gemini_tts' as const },
  { id: 'Achird', name: 'Achird (Friendly)', provider: 'gemini_tts' as const },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi (Casual)', provider: 'gemini_tts' as const },
  { id: 'Vindemiatrix', name: 'Vindemiatrix (Gentle)', provider: 'gemini_tts' as const },
  { id: 'Sadachbia', name: 'Sadachbia (Lively)', provider: 'gemini_tts' as const },
  { id: 'Sadaltager', name: 'Sadaltager (Knowledgeable)', provider: 'gemini_tts' as const },
  { id: 'Sulafat', name: 'Sulafat (Warm)', provider: 'gemini_tts' as const },
];

/**
 * Build a valid WAV file header for raw PCM audio.
 * @param dataLength - byte length of the PCM audio data
 * @param sampleRate - Hz (24000 for Gemini TTS)
 * @param numChannels - 1 = mono
 * @param bitsPerSample - 16
 */
function buildWavHeader(
  dataLength: number,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16,
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);       // ChunkSize
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);                    // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20);                     // AudioFormat = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);            // Subchunk2Size

  return header;
}

export class GeminiTtsAdapter implements TtsAdapter {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey ?? config.tts.geminiApiKey;
    this.model = model ?? DEFAULT_MODEL;
  }

  async generate(opts: TtsOptions): Promise<TtsResult> {
    const apiKey = opts.apiKey ?? this.apiKey;
    if (!apiKey) throw new Error('Gemini TTS API key is required');

    const voiceName = opts.voice_id || 'Kore';
    const url = `${BASE_URL}/${this.model}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{ parts: [{ text: opts.text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini TTS failed (${res.status}): ${errText}`);
    }

    const data = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
      }>;
    };

    const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inlineData?.data) {
      throw new Error('Gemini TTS returned no audio data');
    }

    // Raw PCM: 24kHz, 16-bit, mono
    const pcmBuffer = Buffer.from(inlineData.data, 'base64');
    const wavHeader = buildWavHeader(pcmBuffer.length);
    const audio_data = Buffer.concat([wavHeader, pcmBuffer]);

    // Duration from PCM: samples = bytes / (bitsPerSample/8 * channels) / sampleRate
    const duration_sec = pcmBuffer.length / (2 * 1 * 24000);

    return { audio_data, duration_sec };
  }

  listVoices() {
    return Promise.resolve(GEMINI_TTS_VOICES);
  }
}
