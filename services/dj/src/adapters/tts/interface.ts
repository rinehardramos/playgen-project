export interface TtsOptions {
  voice_id: string;
  text: string;
  apiKey?: string;        // optional station-specific API key
  stability?: number;     // ElevenLabs voice stability (0–1)
  similarity_boost?: number; // ElevenLabs similarity boost (0–1)
}

export interface TtsResult {
  audio_data: Buffer;
  duration_sec: number | null;
}

export interface TtsAdapter {
  generate(opts: TtsOptions): Promise<TtsResult>;
}
