export interface WeatherData {
  city: string;
  condition: string;       // e.g. "Partly Cloudy"
  temperature_c: number;
  humidity_pct: number;
  wind_kph: number;
  summary: string;         // Human-readable: "Partly cloudy, 28°C, light breeze"
}

export interface NewsItem {
  headline: string;
  source?: string;
}

/** Generic plugin interface for external data providers (weather, news, etc.) */
export interface IDataProvider<TConfig, TResult> {
  /** Returns true when the required config keys are present and non-empty */
  isConfigured(cfg: TConfig): boolean;
  /** Fetches live data; throws on error */
  fetch(cfg: TConfig): Promise<TResult>;
}

export interface WeatherProviderConfig {
  api_key: string;
  city: string;
  country_code?: string;
  lat?: number;
  lon?: number;
}

export interface NewsProviderConfig {
  api_key: string;
  country_code?: string;
  query?: string;           // Optional keyword filter (e.g. station city name)
}
