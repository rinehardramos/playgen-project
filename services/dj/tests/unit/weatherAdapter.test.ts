import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openWeatherMapProvider } from '../../src/adapters/data/openWeatherMap.js';
import { mockWeatherProvider, mockIWeatherProvider, mockWeatherData } from '../../src/adapters/data/mock.js';
import type { WeatherProviderConfig } from '../../src/adapters/data/interface.js';

// ─── OpenWeatherMapAdapter ────────────────────────────────────────────────────

describe('openWeatherMapProvider', () => {
  describe('isConfigured', () => {
    it('returns true when api_key and city are provided', () => {
      const cfg: WeatherProviderConfig = { api_key: 'test-key', city: 'Manila' };
      expect(openWeatherMapProvider.isConfigured(cfg)).toBe(true);
    });

    it('returns true when api_key and lat/lon are provided', () => {
      const cfg: WeatherProviderConfig = { api_key: 'test-key', city: '', lat: 14.5, lon: 121.0 };
      expect(openWeatherMapProvider.isConfigured(cfg)).toBe(true);
    });

    it('returns false when api_key is missing', () => {
      const cfg: WeatherProviderConfig = { api_key: '', city: 'Manila' };
      expect(openWeatherMapProvider.isConfigured(cfg)).toBe(false);
    });

    it('returns false when both city and coords are missing', () => {
      const cfg: WeatherProviderConfig = { api_key: 'test-key', city: '' };
      expect(openWeatherMapProvider.isConfigured(cfg)).toBe(false);
    });
  });

  describe('fetch', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('fetches weather data by city and returns WeatherData shape', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Manila',
          weather: [{ description: 'light rain' }],
          main: { temp: 30, humidity: 80 },
          wind: { speed: 5 },
        }),
      } as Response);

      const cfg: WeatherProviderConfig = { api_key: 'test-key', city: 'Manila' };
      const result = await openWeatherMapProvider.fetch(cfg);

      expect(result.city).toBe('Manila');
      expect(result.temperature_c).toBe(30);
      expect(result.condition).toBe('light rain');
      expect(result.humidity_pct).toBe(80);
      expect(result.wind_kph).toBe(18); // 5 m/s × 3.6
      expect(result.summary).toMatch(/Light rain/);
    });

    it('fetches weather data by lat/lon coordinates', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Quezon City',
          weather: [{ description: 'clear sky' }],
          main: { temp: 28, humidity: 70 },
          wind: { speed: 3 },
        }),
      } as Response);

      const cfg: WeatherProviderConfig = { api_key: 'test-key', city: 'QC', lat: 14.6760, lon: 121.0437 };
      const result = await openWeatherMapProvider.fetch(cfg);

      // Verify lat/lon params were used (the URL should have lat= and lon= not q=)
      const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('lat=');
      expect(calledUrl).toContain('lon=');
      expect(calledUrl).not.toContain('q=');
      expect(result.city).toBe('Quezon City');
    });

    it('throws an error when the API returns a non-2xx status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid API key',
      } as Response);

      const cfg: WeatherProviderConfig = { api_key: 'bad-key', city: 'Manila' };
      await expect(openWeatherMapProvider.fetch(cfg)).rejects.toThrow('OpenWeatherMap error 401');
    });
  });
});

// ─── MockWeatherAdapter ───────────────────────────────────────────────────────

describe('mockWeatherProvider', () => {
  it('is always configured', () => {
    expect(mockWeatherProvider.isConfigured({ api_key: '', city: '' })).toBe(true);
    expect(mockWeatherProvider.isConfigured({ api_key: 'any', city: 'any' })).toBe(true);
  });

  it('returns deterministic fake WeatherData', async () => {
    const result = await mockWeatherProvider.fetch({ api_key: '', city: 'Anywhere' });
    expect(result).toMatchObject({
      city: mockWeatherData.city,
      temperature_c: mockWeatherData.temperature_c,
      condition: mockWeatherData.condition,
    });
  });

  it('returns a new object on each call (no shared reference)', async () => {
    const r1 = await mockWeatherProvider.fetch({ api_key: '', city: '' });
    const r2 = await mockWeatherProvider.fetch({ api_key: '', city: '' });
    expect(r1).not.toBe(r2);
    expect(r1).toEqual(r2);
  });
});

// ─── MockIWeatherProvider ─────────────────────────────────────────────────────

describe('mockIWeatherProvider', () => {
  it('returns a WeatherForecast with temperature in both C and F', async () => {
    const forecast = await mockIWeatherProvider.fetchForecast(null, null, 'TestCity');
    expect(forecast.temperature_c).toBe(25);
    expect(forecast.temperature_f).toBe(77); // (25 * 9/5) + 32
    expect(forecast.conditions).toBe('Sunny');
    expect(forecast.description).toBeTruthy();
    expect(forecast.summary).toContain('25°C');
    expect(forecast.summary).toContain('77°F');
  });

  it('uses the provided city name', async () => {
    const forecast = await mockIWeatherProvider.fetchForecast(14.5, 121.0, 'Manila');
    expect(forecast.city).toBe('Manila');
  });

  it('falls back to TestCity when no city is provided', async () => {
    const forecast = await mockIWeatherProvider.fetchForecast(null, null, '');
    expect(forecast.city).toBe('TestCity');
  });

  it('includes all required WeatherForecast fields', async () => {
    const forecast = await mockIWeatherProvider.fetchForecast(null, null, 'Any');
    expect(forecast).toHaveProperty('city');
    expect(forecast).toHaveProperty('temperature_c');
    expect(forecast).toHaveProperty('temperature_f');
    expect(forecast).toHaveProperty('conditions');
    expect(forecast).toHaveProperty('description');
    expect(forecast).toHaveProperty('humidity');
    expect(forecast).toHaveProperty('wind_speed_kmh');
    expect(forecast).toHaveProperty('summary');
  });
});
