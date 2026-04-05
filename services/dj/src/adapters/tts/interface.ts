export interface TtsOptions {
  voice_id: string;
  text: string;
  apiKey?: string;        // optional station-specific API key
  stability?: number;          // ElevenLabs: 0–1, default 0.5
  similarity_boost?: number;   // ElevenLabs: 0–1, default 0.75
}

export interface TtsResult {
  audio_data: Buffer;
  duration_sec: number | null;
}

export interface TtsAdapter {
  generate(opts: TtsOptions): Promise<TtsResult>;
}
