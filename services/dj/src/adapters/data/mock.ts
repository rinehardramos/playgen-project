/**
 * MockWeatherAdapter — returns deterministic fake weather data.
 * Use in unit tests instead of hitting the real OpenWeatherMap API.
 */
import type { IDataProvider, WeatherData, WeatherProviderConfig } from './interface.js';
import type { IWeatherProvider } from '@playgen/types';
import type { WeatherForecast } from '@playgen/types';

/** Fake WeatherData (matches the WeatherData shape from interface.ts). */
export const mockWeatherData: WeatherData = {
  city: 'TestCity',
  condition: 'Sunny',
  temperature_c: 25,
  humidity_pct: 60,
  wind_kph: 15,
  summary: 'Sunny, 25°C, 15 kph winds',
};

/** IDataProvider<WeatherProviderConfig, WeatherData> implementation for tests. */
export const mockWeatherProvider: IDataProvider<WeatherProviderConfig, WeatherData> = {
  isConfigured(_cfg: WeatherProviderConfig): boolean {
    return true;
  },
  async fetch(_cfg: WeatherProviderConfig): Promise<WeatherData> {
    return { ...mockWeatherData };
  },
};

/** IWeatherProvider implementation for tests. */
export const mockIWeatherProvider: IWeatherProvider = {
  async fetchForecast(
    _lat: number | null,
    _lon: number | null,
    city: string,
  ): Promise<WeatherForecast> {
    const tempC = 25;
    const tempF = Math.round(tempC * 9 / 5 + 32);
    return {
      city: city || 'TestCity',
      temperature_c: tempC,
      temperature_f: tempF,
      conditions: 'Sunny',
      description: 'clear skies and sunshine',
      humidity: 60,
      wind_speed_kmh: 15,
      summary: `Sunny, ${tempC}°C (${tempF}°F), 15 kph winds`,
    };
  },
};
