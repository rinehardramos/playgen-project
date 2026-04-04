export interface TtsOptions {
  voice_id: string;
  text: string;
  output_path: string;    // local file path to write mp3
  apiKey?: string;        // optional station-specific API key
}

export interface TtsResult {
  audio_path: string;
  duration_sec: number | null;
}

export interface TtsAdapter {
  generate(opts: TtsOptions): Promise<TtsResult>;
}
