import type { IDataProvider, WeatherData, WeatherProviderConfig } from './interface.js';

const BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';

export const openWeatherMapProvider: IDataProvider<WeatherProviderConfig, WeatherData> = {
  isConfigured(cfg) {
    return !!(cfg.api_key && (cfg.city || (cfg.lat != null && cfg.lon != null)));
  },

  async fetch(cfg) {
    const params = new URLSearchParams({ appid: cfg.api_key, units: 'metric' });
    if (cfg.lat != null && cfg.lon != null) {
      params.set('lat', String(cfg.lat));
      params.set('lon', String(cfg.lon));
    } else {
      params.set('q', cfg.country_code ? `${cfg.city},${cfg.country_code}` : cfg.city);
    }

    const res = await fetch(`${BASE_URL}?${params}`);
    if (!res.ok) {
      throw new Error(`OpenWeatherMap error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as {
      name: string;
      weather: Array<{ description: string }>;
      main: { temp: number; humidity: number };
      wind: { speed: number };
    };

    const condition = data.weather[0]?.description ?? 'unknown';
    const temp = Math.round(data.main.temp);
    const humidity = data.main.humidity;
    const wind = Math.round(data.wind.speed * 3.6); // m/s → kph

    return {
      city: data.name,
      condition,
      temperature_c: temp,
      humidity_pct: humidity,
      wind_kph: wind,
      summary: `${condition.charAt(0).toUpperCase() + condition.slice(1)}, ${temp}°C, ${wind} kph winds`,
    };
  },
};
