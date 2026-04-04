export interface TtsOptions {
  voice_id: string;
  text: string;
  apiKey?: string;        // optional station-specific API key
}

export interface TtsResult {
  audio_data: Buffer;
  duration_sec: number | null;
}

export interface TtsAdapter {
  generate(opts: TtsOptions): Promise<TtsResult>;
}
