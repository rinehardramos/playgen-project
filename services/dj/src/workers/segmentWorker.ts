import { getPool } from '../db.js';
import { llmComplete } from '../adapters/llm/openrouter.js';
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder.js';
import { logLlmUsage } from '../lib/usageLogger.js';
import { checkLlmRateLimit } from '../lib/rateLimiter.js';
import { getInfoBrokerClient } from '../lib/infoBroker.js';
import { config } from '../config.js';
import type { DjSegmentType, DjProfile } from '@playgen/types';
import type { JokeStyle, WeatherResponse, NewsResponse } from '@playgen/info-broker-client';

export interface SegmentJobData {
  stationId: string;
  segmentType: DjSegmentType;
  withAudio?: boolean;
  djProfileId?: string;
  overrides?: {
    weather?: object;
    news?: object;
    joke?: object;
    mentions?: object;
  };
}

export async function runSegmentJob(data: SegmentJobData): Promise<{ segmentId: string; text: string; audioUrl?: string }> {
  const pool = getPool();

  // Load station
  const { rows: stationRows } = await pool.query(
    `SELECT * FROM stations WHERE id = $1`,
    [data.stationId],
  );
  const station = stationRows[0];
  if (!station) throw new Error(`Station ${data.stationId} not found`);

  // Load station settings
  const { rows: settingsRows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM station_settings WHERE station_id = $1`, [data.stationId],
  );
  const stationSettings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

  // Load DJ profile
  let profile: DjProfile | null = null;
  if (data.djProfileId) {
    const { rows } = await pool.query<DjProfile>(`SELECT * FROM dj_profiles WHERE id = $1`, [data.djProfileId]);
    profile = rows[0] ?? null;
  }
  if (!profile) {
    const { getDefaultProfile } = await import('../services/profileService.js');
    profile = await getDefaultProfile(station.company_id);
  }
  if (!profile) throw new Error('No DJ profile found');

  const broker = getInfoBrokerClient();
  const personaConfig = (profile.persona_config as Record<string, unknown>) ?? {};

  // Broker fan-out (skip for adlib; use overrides if provided)
  let weatherData: WeatherResponse | undefined = data.overrides?.weather as WeatherResponse | undefined;
  let newsData: NewsResponse | undefined = data.overrides?.news as NewsResponse | undefined;
  let jokeData: object | undefined = data.overrides?.joke;

  if (data.segmentType !== 'adlib' && broker && !data.overrides) {
    const needsWeather = data.segmentType === 'weather_tease';
    const needsNews = data.segmentType === 'current_events';
    const needsJoke = data.segmentType === 'joke';

    const [w, n, j] = await Promise.all([
      needsWeather ? broker.getWeather({ city: station.city ?? undefined }) : Promise.resolve(null),
      needsNews ? broker.getNews({ scope: (station.news_scope ?? 'global') as 'global' | 'country' | 'local', topic: station.news_topic ?? 'any' }) : Promise.resolve(null),
      needsJoke ? broker.getJoke({ style: ((personaConfig.joke_style as string) ?? 'witty') as JokeStyle, safe: true }) : Promise.resolve(null),
    ]);
    if (w) weatherData = w;
    if (n) newsData = n;
    if (j) jokeData = j;
  }

  // Rate limit check
  const rateCheck = await checkLlmRateLimit(data.stationId);
  if (!rateCheck.allowed) throw new Error(`LLM rate limit: ${rateCheck.reason}`);

  const effectiveLlmProvider = stationSettings['llm_provider'] ?? config.llm.provider;
  const effectiveLlmModel = stationSettings['llm_model'] || profile.llm_model;
  const effectiveLlmApiKey = stationSettings['llm_api_key'] ?? undefined;

  const ctx = {
    station_name: station.name,
    station_timezone: station.timezone,
    station_city: station.city ?? '',
    station_identity: { callsign: station.callsign, tagline: station.tagline, frequency: station.frequency, city: station.city },
    current_date: new Date().toISOString().split('T')[0],
    current_hour: new Date().getHours(),
    dj_profile: profile,
    segment_type: data.segmentType,
    weather: weatherData,
    news_items: newsData?.items,
    broker_joke: jokeData as import('@playgen/info-broker-client').JokeResponse | undefined,
    previousSegmentTexts: [],
    segmentIndex: 0,
  };

  const systemPrompt = buildSystemPrompt(profile);
  const userPrompt = buildUserPrompt(ctx);

  const llmResult = await llmComplete(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    { model: effectiveLlmModel, apiKey: effectiveLlmApiKey, provider: effectiveLlmProvider },
  );

  if (llmResult.usage) {
    logLlmUsage({ station_id: data.stationId, script_id: null as unknown as string, provider: effectiveLlmProvider, model: effectiveLlmModel, usage: llmResult.usage, metadata: { segment_type: data.segmentType, standalone: true } });
  }

  // Persist as standalone segment (script_id = NULL, standalone = true)
  const { rows: segRows } = await pool.query(
    `INSERT INTO dj_segments (script_id, segment_type, position, script_text, standalone)
     VALUES (NULL, $1, 0, $2, true)
     RETURNING id`,
    [data.segmentType, llmResult.text],
  );

  return { segmentId: segRows[0].id, text: llmResult.text };
}
