import { getPool } from '../db.js';
import { getSocialProviders } from '../adapters/social/index.js';
import { llmComplete } from '../adapters/llm/openrouter.js';
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder.js';
import type { StationIdentity } from '../lib/promptBuilder.js';
import { logLlmUsage } from '../lib/usageLogger.js';
import { checkLlmRateLimit } from '../lib/rateLimiter.js';
import { getInfoBrokerClient } from '../lib/infoBroker.js';
import { sanitizeUntrusted } from '../lib/promptGuard.js';
import type { WeatherResponse, NewsResponse, JokeResponse } from '@playgen/info-broker-client';
import { config } from '../config.js';
import { buildManifest } from '../services/manifestService.js';
import type { DjGenerationJobData, Job } from '../queues/djQueue.js';
import type { DjProfile, DjSegmentType, DjScriptTemplate } from '@playgen/types';

/** Fetch all station_settings for a given station into a key→value map (real values, un-masked). */
async function loadStationSettings(stationId: string): Promise<Record<string, string>> {
  const { rows } = await getPool().query<{ key: string; value: string }>(
    `SELECT key, value FROM station_settings WHERE station_id = $1`,
    [stationId],
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

interface PlaylistEntryRow {
  id: string;
  hour: number;
  position: number;
  song_title: string;
  song_artist: string;
  duration_sec: number | null;
}

interface StationRow {
  id: string;
  name: string;
  timezone: string;
  locale_code: string | null;
  company_id: string;
  city: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  openrouter_api_key: string | null;
  openai_api_key: string | null;
  elevenlabs_api_key: string | null;
  anthropic_api_key: string | null;
  gemini_api_key: string | null;
  mistral_api_key: string | null;
  // Station identity fields (migration 039)
  callsign: string | null;
  tagline: string | null;
  frequency: string | null;
  news_scope: string | null;
  news_topic: string | null;
}

/**
 * Format a Date object to a human-readable time string using the station's locale/timezone.
 * Produces a 12hr clock for most locales (e.g. "3:47 PM"), falling back to UTC on error.
 */
function formatLocalTime(date: Date, timezone: string, localeCode?: string | null): string {
  try {
    const locale = localeCode ?? 'en-US';
    return date.toLocaleTimeString(locale, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    // Graceful fallback — unsupported timezone or locale
    return date.toLocaleTimeString('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}

// Determine which song-linked segment types to generate for a given playlist position
function segmentsForEntry(
  entry: PlaylistEntryRow,
  entries: PlaylistEntryRow[],
  idx: number,
): DjSegmentType[] {
  const types: DjSegmentType[] = [];
  const isFirst = idx === 0;
  const isLast = idx === entries.length - 1;
  const total = entries.length;

  if (isFirst) types.push('show_intro');
  types.push(isFirst ? 'song_intro' : 'song_transition');

  // Time check at the start of each new hour boundary
  if (!isFirst && entry.hour !== entries[idx - 1].hour) {
    types.push('time_check');
  }



  // Joke once, around 1/4 through the show
  if (idx === Math.max(1, Math.floor(total / 4))) {
    types.push('joke');
  }

  // Weather tease once, around the middle of the show
  if (idx === Math.floor(total / 2) && !isFirst) {
    types.push('weather_tease');
  }

  // Current events once, around 2/3 through
  if (idx === Math.floor(total * 2 / 3) && !isFirst && !isLast) {
    types.push('current_events');
  }

  // Listener activity once, around 3/4 through
  if (idx === Math.floor(total * 3 / 4) && !isFirst && !isLast) {
    types.push('listener_activity');
  }

  // Station ID drop again at 2/3 through (for longer shows)
  if (total > 12 && idx === Math.floor(total * 2 / 3) + 1 && !isLast) {
    types.push('station_id');
  }

  if (isLast) types.push('show_outro');

  return types;
}

export async function runGenerationJob(
  data: DjGenerationJobData,
  job?: Job<DjGenerationJobData>,
): Promise<void> {
  const pool = getPool();
  const start = Date.now();

  const reportProgress = async (pct: number, step: string) => {
    try {
      await job?.updateProgress({ pct, step });
    } catch {
      // Non-critical — don't let progress update failures abort the job
    }
  };

  await reportProgress(5, 'Loading station config…');

  // 1. Load station info (including API key columns + station identity columns from migration 039)
  const { rows: stationRows } = await pool.query<StationRow>(
    `SELECT id, name, timezone, locale_code, company_id,
            city, country_code, latitude, longitude,
            openrouter_api_key, openai_api_key, elevenlabs_api_key, anthropic_api_key, gemini_api_key, mistral_api_key,
            callsign, tagline, frequency,
            news_scope, news_topic
     FROM stations WHERE id = $1`,
    [data.station_id],
  );
  const station = stationRows[0];
  if (!station) throw new Error(`Station ${data.station_id} not found`);

  const stationIdentity: StationIdentity = {
    callsign: station.callsign,
    tagline: station.tagline,
    frequency: station.frequency,
    city: station.city,
  };

  // 1b. Load per-station settings (API key overrides, model, TTS provider, etc.)
  const stationSettings = await loadStationSettings(data.station_id);

  // 2. Load DJ profile
  let profile: DjProfile | null = null;
  if (data.dj_profile_id) {
    const { rows } = await pool.query<DjProfile>(
      `SELECT * FROM dj_profiles WHERE id = $1`,
      [data.dj_profile_id],
    );
    profile = rows[0] ?? null;
  }
  if (!profile) {
    const { getDefaultProfile } = await import('../services/profileService.js');
    profile = await getDefaultProfile(station.company_id);
  }
  if (!profile) throw new Error('No DJ profile found for station');

  // 2b. Pre-flight: fail fast if no LLM API key is available before creating any DB records.
  //     Both per-station keys (from station columns / station_settings) and env var defaults
  //     are checked so the error message tells the operator exactly what to configure.
  const earlyLlmProvider = stationSettings['llm_provider'] ?? config.llm.provider;
  const earlyLlmApiKey =
    stationSettings['llm_api_key'] ??
    (earlyLlmProvider === 'anthropic'
      ? station.anthropic_api_key
      : earlyLlmProvider === 'gemini'
      ? station.gemini_api_key
      : earlyLlmProvider === 'openai'
      ? station.openai_api_key
      : earlyLlmProvider === 'mistral'
      ? station.mistral_api_key
      : station.openrouter_api_key) ??
    undefined;
  const earlyLlmFallback =
    earlyLlmProvider === 'openai'
      ? config.llm.openaiApiKey
      : earlyLlmProvider === 'anthropic'
      ? config.llm.anthropicApiKey
      : config.openRouter.apiKey;
  if (!earlyLlmApiKey && !earlyLlmFallback) {
    throw new Error(
      `No LLM API key configured for provider "${earlyLlmProvider}". ` +
      `Set OPENROUTER_API_KEY (or the relevant key) in Railway environment variables, ` +
      `or add a per-station API key in Station Settings → DJ Settings.`,
    );
  }

  // 1c. Fetch weather + news via info-broker (soft-fail; null if broker unconfigured/unreachable)
  let weatherData: WeatherResponse | undefined;
  let newsData: NewsResponse | undefined;

  const resolvedCity: string = station.city ?? '';

  const broker = getInfoBrokerClient();
  if (!broker) {
    console.warn('[generationWorker] INFO_BROKER_BASE_URL not configured — weather_tease/current_events segments will skip external data');
  } else {
    const [weatherResult, newsResult] = await Promise.all([
      broker.getWeather({
        city: resolvedCity || undefined,
        country_code: station.country_code ?? undefined,
        lat: station.latitude ?? undefined,
        lon: station.longitude ?? undefined,
      }),
      broker.getNews({
        scope: (station.news_scope as 'global' | 'country' | 'local') ?? 'global',
        topic: station.news_topic ?? 'any',
        country_code: station.country_code ?? undefined,
        limit: 10,
      }),
    ]);
    if (weatherResult) {
      weatherData = weatherResult;
      console.info(`[generationWorker] Weather (broker): ${weatherResult.summary}`);
    }
    if (newsResult) {
      newsData = newsResult;
      console.info(`[generationWorker] News (broker): ${newsResult.items.length} headlines`);
    }
  }

  // 1d. Fetch joke for this show (after profile so we have joke_style)
  const personaConfig = profile.persona_config ?? {};
  /** Joke style sourced from persona_config. Defaults to 'witty'. */
  const jokeStyle: string = (personaConfig.joke_style as string) ?? 'witty';
  let jokeData: JokeResponse | undefined;
  if (broker) {
    const jokeResult = await broker.getJoke({
      style: jokeStyle as import('@playgen/info-broker-client').JokeStyle,
      safe: true,
    });
    if (jokeResult) {
      jokeData = jokeResult;
    }
  }

  await reportProgress(10, 'Loading playlist…');

  // 3. Load playlist entries with song data
  const { rows: entries } = await pool.query<PlaylistEntryRow>(
    `SELECT pe.id, pe.hour, pe.position,
            s.title AS song_title, s.artist AS song_artist, s.duration_sec
     FROM playlist_entries pe
     JOIN songs s ON s.id = pe.song_id
     WHERE pe.playlist_id = $1
     ORDER BY pe.hour, pe.position`,
    [data.playlist_id],
  );
  if (entries.length === 0) throw new Error('Playlist has no entries');

  // 4. Batch-load all script templates for this station
  const { rows: templateRows } = await pool.query<DjScriptTemplate>(
    `SELECT * FROM dj_script_templates WHERE station_id = $1 AND is_active = true`,
    [data.station_id],
  );
  const templateMap = new Map<string, string>();
  for (const t of templateRows) {
    templateMap.set(t.segment_type, t.prompt_template);
  }

  // 4b. Load pre-recorded adlib clips for this station (used to skip LLM for adlib segments)
  interface AdlibClipRow { id: string; name: string; audio_url: string; audio_duration_sec: string | null; }
  const { rows: adlibClips } = await pool.query<AdlibClipRow>(
    `SELECT id, name, audio_url, audio_duration_sec FROM dj_adlib_clips WHERE station_id = $1`,
    [data.station_id],
  );

  // 4c. Load pending listener shoutouts for this station (max 3 per script)
  interface ShoutoutRow { id: string; listener_name: string | null; message: string; }
  const { rows: pendingShoutouts } = await pool.query<ShoutoutRow>(
    `SELECT id, listener_name, message FROM listener_shoutouts
     WHERE station_id = $1 AND status = 'pending'
     ORDER BY created_at ASC LIMIT 3`,
    [data.station_id],
  );

  // 4d. Fetch social posts from connected Facebook/Twitter accounts (non-fatal if unavailable)
  interface SocialShoutout { listener_name: string | null; message: string; }
  const socialShoutouts: SocialShoutout[] = [];
  try {
    const socialProviders = await getSocialProviders(data.station_id, pool);
    for (const provider of socialProviders) {
      const posts = await provider.fetchPosts({ since_hours: 24, limit: 3 });
      for (const post of posts) {
        socialShoutouts.push({
          listener_name: post.author_name ?? post.author_handle,
          message: post.text,
        });
      }
    }
  } catch (err) {
    console.warn('[generationWorker] Social fetch failed (non-fatal):', err);
  }

  // Merge manual shoutouts with social posts (manual first, then social, max 3 total)
  const allListenerContent: ShoutoutRow[] = [
    ...pendingShoutouts,
    ...socialShoutouts
      .filter((s) => !pendingShoutouts.some((p) => p.message === s.message))
      .map((s) => ({ id: '', listener_name: s.listener_name, message: s.message })),
  ].slice(0, 3);

  // 5. Create the script record
  const { rows: scriptRows } = await pool.query(
    `INSERT INTO dj_scripts
       (playlist_id, station_id, dj_profile_id, review_status, llm_model, total_segments)
     VALUES ($1, $2, $3, $4, $5, 0)
     RETURNING id`,
    [
      data.playlist_id,
      data.station_id,
      profile.id,
      data.auto_approve ? 'auto_approved' : 'pending_review',
      profile.llm_model,
    ],
  );
  const script_id: string = scriptRows[0].id;

  // 6. Generate segments
  const currentDate = new Date().toISOString().split('T')[0];
  let position = 0;

  // Resolve effective LLM config (TTS is now generated on-demand per segment)
  const effectiveLlmProvider = stationSettings['llm_provider'] ?? config.llm.provider;
  const effectiveLlmModel    = stationSettings['llm_model'] || profile.llm_model;

  const effectiveLlmApiKey = stationSettings['llm_api_key']
    ?? (effectiveLlmProvider === 'anthropic'
      ? station.anthropic_api_key
      : effectiveLlmProvider === 'gemini'
      ? station.gemini_api_key
      : effectiveLlmProvider === 'openai'
      ? station.openai_api_key
      : effectiveLlmProvider === 'mistral'
      ? station.mistral_api_key
      : station.openrouter_api_key)
    ?? undefined;

  const effectiveTtsProvider = (stationSettings['tts_provider'] ?? config.tts.provider) as string;
  const effectiveTtsApiKey = stationSettings['tts_api_key']
    ?? (effectiveTtsProvider === 'elevenlabs'
      ? station.elevenlabs_api_key
      : effectiveTtsProvider === 'google'
      ? station.gemini_api_key   // Google TTS uses the same Google/Gemini API key
      : effectiveTtsProvider === 'gemini_tts'
      ? station.gemini_api_key   // Gemini native TTS also uses the Gemini API key
      : effectiveTtsProvider === 'mistral'
      ? station.mistral_api_key
      : station.openai_api_key)
    ?? (effectiveTtsProvider === 'elevenlabs'
      ? config.tts.elevenlabsApiKey
      : effectiveTtsProvider === 'google'
      ? config.tts.googleApiKey
      : effectiveTtsProvider === 'gemini_tts'
      ? config.tts.geminiApiKey
      : effectiveTtsProvider === 'mistral'
      ? config.tts.mistralApiKey
      : config.tts.openaiApiKey);

  // ttsEnabled kept as a reference for future use (TTS is generated on-demand per segment)
  void !!(effectiveTtsApiKey);

  // ── Interval configuration for station_id and time_check segments ────────────
  /** Cumulative show content seconds between station_id injections (default 30 min). */
  const stationIdIntervalSec = (personaConfig.station_id_interval_minutes ?? 30) * 60;
  /** Cumulative show content seconds between time_check injections (default 60 min). */
  const timeCheckIntervalSec = (personaConfig.time_check_interval_minutes ?? 60) * 60;
  /** Adlib injection interval in songs (default 4). 0 = disabled. */
  const adlibIntervalSongs = personaConfig.adlib_interval_songs ?? 4;

  // Collect all generated segments for variety context
  const generatedSegments: Array<{
    id: string;
    script_text: string;
    position: number;
  }> = [];
  // Running list of generated texts — passed to each LLM call to enforce variety
  const generatedTexts: string[] = [];

  // Pre-count total segment slots for progress reporting (approximate — non-song segments added dynamically)
  let totalSegmentSlots = 0;
  for (let i = 0; i < entries.length; i++) {
    totalSegmentSlots += segmentsForEntry(entries[i], entries, i).length;
  }
  // Add shoutout segments (injected after show_intro — includes manual + social)
  totalSegmentSlots += allListenerContent.length;

  let segmentsDone = 0;

  // ── Helper: LLM-generate and INSERT a non-song segment (station_id / time_check) ─
  async function generateNonSongSegment(
    segment_type: DjSegmentType,
    overrides?: { current_time_local?: string; current_hour?: number },
  ): Promise<void> {
    const customTemplate = templateMap.get(segment_type);
    let rejectionContext = '';
    if (data.rejection_notes) {
      rejectionContext = `\n\nIMPORTANT: The previous script was rejected by the reviewer. Their feedback: "${data.rejection_notes}". Please rewrite accordingly.`;
    }
    const ctx = {
      station_name: station.name,
      station_timezone: station.timezone,
      station_city: resolvedCity,
      station_identity: stationIdentity,
      current_date: currentDate,
      current_hour: overrides?.current_hour ?? 0,
      current_time_local: overrides?.current_time_local,
      dj_profile: profile!,
      segment_type,
      custom_template: customTemplate,
      joke_style: jokeStyle,
      broker_joke: segment_type === 'joke' ? jokeData : undefined,
      previousSegmentTexts: generatedTexts.slice(-4),
      segmentIndex: position,
    };
    const systemPrompt = buildSystemPrompt(profile!);
    const userPrompt = buildUserPrompt(ctx) + rejectionContext;

    // Soft rate limit check — skip segment rather than abort the whole script
    const llmRateCheck = await checkLlmRateLimit(data.station_id);
    if (!llmRateCheck.allowed) {
      console.warn(`[generationWorker] LLM rate limit hit for segment=${segment_type}: ${llmRateCheck.reason}`);
      return;
    }

    console.info(
      `[generationWorker] LLM call — provider=${effectiveLlmProvider} model=${effectiveLlmModel} hasKey=${!!effectiveLlmApiKey} segment=${segment_type} (non-song)`,
    );
    let script_text: string;
    try {
      const llmResult = await llmComplete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        {
          model: effectiveLlmModel,
          temperature: profile!.llm_temperature != null ? Number(profile!.llm_temperature) : undefined,
          apiKey: effectiveLlmApiKey ?? undefined,
          provider: effectiveLlmProvider,
        },
      );
      script_text = llmResult.text;
      if (llmResult.usage) {
        logLlmUsage({
          station_id: data.station_id,
          script_id,
          provider: effectiveLlmProvider,
          model: effectiveLlmModel,
          usage: llmResult.usage,
          metadata: { segment_type },
        });
      }
    } catch (llmErr) {
      console.error(
        `[generationWorker] LLM call FAILED — provider=${effectiveLlmProvider} model=${effectiveLlmModel} error:`,
        llmErr,
      );
      throw llmErr;
    }
    const pos = position++;
    const segResult = await pool.query(
      `INSERT INTO dj_segments
         (script_id, playlist_entry_id, segment_type, position, script_text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [script_id, null, segment_type, pos, script_text],
    );
    generatedSegments.push({ id: segResult.rows[0].id, script_text, position: pos });
    generatedTexts.push(script_text);
  }

  // ── Tracking state for periodic segment injection ─────────────────────────────
  /** Cumulative content duration in seconds for all songs processed so far. */
  let cumulativeSec = 0;
  /** Cumulative seconds at the last station_id injection. */
  let lastStationIdAtSec = 0;
  /** Cumulative seconds at the last time_check injection. */
  let lastTimeCheckAtSec = 0;
  /** Whether the opening station_id (right after first song_intro) has been inserted. */
  let openingStationIdInserted = false;
  /** Songs processed since the last adlib injection (used to enforce adlibIntervalSongs). */
  let songsSinceLastAdlib = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const prev = entries[i - 1];
    const next = entries[i + 1];
    const isFirst = i === 0;
    const isLast = i === entries.length - 1;
    const segmentTypes = segmentsForEntry(entry, entries, i);

    // Per-song broker enrichment: fetch prev/next song metadata in parallel
    let prevEnrich: import('@playgen/info-broker-client').SongEnrichment | null = null;
    let nextEnrich: import('@playgen/info-broker-client').SongEnrichment | null = null;
    if (broker) {
      const [pe, ne] = await Promise.all([
        prev ? broker.enrichSong({ title: prev.song_title, artist: prev.song_artist }) : Promise.resolve(null),
        next ? broker.enrichSong({ title: next.song_title, artist: next.song_artist }) : Promise.resolve(null),
      ]);
      prevEnrich = pe;
      nextEnrich = ne;
    }

    const prevSong = prev ? {
      title: prev.song_title,
      artist: prev.song_artist,
      duration_sec: prev.duration_sec,
      album: prevEnrich?.album,
      release_year: prevEnrich?.release_year,
      genres: prevEnrich?.genres,
      trivia: prevEnrich?.trivia ? sanitizeUntrusted(prevEnrich.trivia, 500) : null,
    } : undefined;

    const nextSong = next ? {
      title: next.song_title,
      artist: next.song_artist,
      duration_sec: next.duration_sec,
      album: nextEnrich?.album,
      release_year: nextEnrich?.release_year,
      genres: nextEnrich?.genres,
      trivia: nextEnrich?.trivia ? sanitizeUntrusted(nextEnrich.trivia, 500) : null,
    } : undefined;

    // ── Inject non-song segments BEFORE this song (not at show open) ──────────
    if (!isFirst) {
      // time_check: fire when cumulative show content has crossed a new interval boundary
      const secSinceLastTimeCheck = cumulativeSec - lastTimeCheckAtSec;
      if (timeCheckIntervalSec > 0 && secSinceLastTimeCheck >= timeCheckIntervalSec) {
        const now = new Date();
        const timeLocal = formatLocalTime(now, station.timezone, station.locale_code);
        const hourLocal = parseInt(
          now.toLocaleString('en-US', { timeZone: station.timezone, hour: 'numeric', hour12: false }),
          10,
        );
        await reportProgress(
          10 + Math.round((segmentsDone / totalSegmentSlots) * 80),
          'Writing time check…',
        );
        await generateNonSongSegment('time_check', { current_time_local: timeLocal, current_hour: hourLocal });
        lastTimeCheckAtSec = cumulativeSec;
      }

      // station_id: fire periodically after the opening station_id has been inserted
      const secSinceLastStationId = cumulativeSec - lastStationIdAtSec;
      if (
        openingStationIdInserted &&
        stationIdIntervalSec > 0 &&
        secSinceLastStationId >= stationIdIntervalSec
      ) {
        await reportProgress(
          10 + Math.round((segmentsDone / totalSegmentSlots) * 80),
          'Writing station ID…',
        );
        await generateNonSongSegment('station_id');
        lastStationIdAtSec = cumulativeSec;
      }

      // adlib: inject every N songs (not first or last), when interval > 0
      songsSinceLastAdlib++;
      if (!isLast && adlibIntervalSongs > 0 && songsSinceLastAdlib >= adlibIntervalSongs) {
        await reportProgress(
          10 + Math.round((segmentsDone / totalSegmentSlots) * 80),
          'Writing adlib…',
        );
        if (adlibClips.length > 0) {
          // Use a random pre-recorded clip — skip LLM entirely
          const clip = adlibClips[Math.floor(Math.random() * adlibClips.length)];
          const pos = position++;
          const durationSec = clip.audio_duration_sec != null ? parseFloat(clip.audio_duration_sec) : null;
          await pool.query(
            `INSERT INTO dj_segments
               (script_id, playlist_entry_id, segment_type, position, script_text, audio_url, audio_duration_sec, segment_review_status)
             VALUES ($1, $2, 'adlib', $3, $4, $5, $6, 'auto_approved')`,
            [script_id, null, pos, clip.name, clip.audio_url, durationSec],
          );
          generatedTexts.push(clip.name);
        } else {
          // No pre-recorded clips — generate via LLM
          // ADLIB GUARD: adlib segments never call the broker — pure persona freeform
          await generateNonSongSegment('adlib');
        }
        songsSinceLastAdlib = 0;
        segmentsDone++;
      }
    }

    for (const segment_type of segmentTypes) {
      const customTemplate = templateMap.get(segment_type);

      // Build rejection context if this is a rewrite
      let rejectionContext = '';
      if (data.rejection_notes) {
        rejectionContext = `\n\nIMPORTANT: The previous script was rejected by the reviewer. Their feedback: "${data.rejection_notes}". Please rewrite accordingly.`;
      }

      const ctx = {
        station_name: station.name,
        station_timezone: station.timezone,
        station_city: resolvedCity,
        station_identity: stationIdentity,
        current_date: currentDate,
        current_hour: entry.hour,
        dj_profile: profile,
        prev_song: prevSong,
        next_song: nextSong,
        segment_type,
        custom_template: customTemplate,
        weather: weatherData,
        news_items: newsData?.items,
        joke_style: jokeStyle,
        broker_joke: segment_type === 'joke' ? jokeData : undefined,
        previousSegmentTexts: generatedTexts.slice(-4),
        segmentIndex: position,
      };

      const systemPrompt = buildSystemPrompt(profile);
      const userPrompt = buildUserPrompt(ctx) + rejectionContext;

      console.info(
        `[generationWorker] LLM call — provider=${effectiveLlmProvider} model=${effectiveLlmModel} hasKey=${!!effectiveLlmApiKey} segment=${segment_type}`,
      );

      // Progress: LLM phase spans 10% → 90% (TTS is now manual per-segment)
      const llmProgress = 10 + Math.round((segmentsDone / totalSegmentSlots) * 80);
      await reportProgress(llmProgress, `Writing ${segment_type.replace('_', ' ')} (${segmentsDone + 1}/${totalSegmentSlots})…`);

      // Soft rate limit check — skip segment rather than abort the whole script
      const llmRateCheckSong = await checkLlmRateLimit(data.station_id);
      if (!llmRateCheckSong.allowed) {
        console.warn(`[generationWorker] LLM rate limit hit for segment=${segment_type}: ${llmRateCheckSong.reason}`);
        segmentsDone++;
        continue;
      }

      let script_text: string;
      try {
        const llmResult = await llmComplete(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          {
            model: effectiveLlmModel,
            temperature: profile.llm_temperature != null ? Number(profile.llm_temperature) : undefined,
            apiKey: effectiveLlmApiKey ?? undefined,
            provider: effectiveLlmProvider,
          },
        );
        script_text = llmResult.text;
        if (llmResult.usage) {
          logLlmUsage({
            station_id: data.station_id,
            script_id,
            provider: effectiveLlmProvider,
            model: effectiveLlmModel,
            usage: llmResult.usage,
            metadata: { segment_type },
          });
        }
      } catch (llmErr) {
        console.error(
          `[generationWorker] LLM call FAILED — provider=${effectiveLlmProvider} model=${effectiveLlmModel} error:`,
          llmErr,
        );
        throw llmErr;
      }

      const pos = position++;
      const segResult = await pool.query(
        `INSERT INTO dj_segments
           (script_id, playlist_entry_id, segment_type, position, script_text)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [script_id, entry.id, segment_type, pos, script_text],
      );

      generatedSegments.push({ id: segResult.rows[0].id, script_text, position: pos });
      generatedTexts.push(script_text);
      segmentsDone++;

      // Inject listener shoutout segments immediately after show_intro (manual + social)
      if (segment_type === 'show_intro' && allListenerContent.length > 0) {
        for (const shoutout of allListenerContent) {
          const shoutoutProgress = 10 + Math.round((segmentsDone / totalSegmentSlots) * 80);
          await reportProgress(shoutoutProgress, `Writing listener shoutout (${segmentsDone + 1}/${totalSegmentSlots})…`);

          const shoutoutCtx = {
            station_name: station.name,
            station_timezone: station.timezone,
            station_city: resolvedCity,
            station_identity: stationIdentity,
            current_date: currentDate,
            current_hour: entry.hour,
            dj_profile: profile,
            segment_type: 'listener_activity' as DjSegmentType,
            custom_template: templateMap.get('listener_activity'),
            shoutout: {
              listener_name: shoutout.listener_name ?? 'a listener',
              listener_message: shoutout.message,
            },
            previousSegmentTexts: generatedTexts.slice(-4),
            segmentIndex: position,
          };

          const shoutoutSystemPrompt = buildSystemPrompt(profile);
          const shoutoutUserPrompt = buildUserPrompt(shoutoutCtx) + (data.rejection_notes
            ? `\n\nIMPORTANT: The previous script was rejected by the reviewer. Their feedback: "${data.rejection_notes}". Please rewrite accordingly.`
            : '');

          let shoutoutText: string;
          try {
            const shoutoutResult = await llmComplete(
              [
                { role: 'system', content: shoutoutSystemPrompt },
                { role: 'user', content: shoutoutUserPrompt },
              ],
              {
                model: effectiveLlmModel,
                temperature: profile.llm_temperature != null ? Number(profile.llm_temperature) : undefined,
                apiKey: effectiveLlmApiKey ?? undefined,
                provider: effectiveLlmProvider,
              },
            );
            shoutoutText = shoutoutResult.text;
            if (shoutoutResult.usage) {
              logLlmUsage({
                station_id: data.station_id,
                script_id,
                provider: effectiveLlmProvider,
                model: effectiveLlmModel,
                usage: shoutoutResult.usage,
                metadata: { segment_type: 'listener_activity' },
              });
            }
          } catch (llmErr) {
            console.error('[generationWorker] Shoutout LLM call FAILED:', llmErr);
            throw llmErr;
          }

          const shoutoutPos = position++;
          await pool.query(
            `INSERT INTO dj_segments
               (script_id, playlist_entry_id, segment_type, position, script_text)
             VALUES ($1, $2, $3, $4, $5)`,
            [script_id, null, 'listener_activity', shoutoutPos, shoutoutText],
          );

          generatedTexts.push(shoutoutText);
          segmentsDone++;
        }

        // Mark manual shoutouts as used (social posts have no DB id — skip them)
        const manualShoutoutIds = pendingShoutouts.map((s) => s.id).filter(Boolean);
        if (manualShoutoutIds.length > 0) {
          await pool.query(
            `UPDATE listener_shoutouts
             SET status = 'used', used_in_script_id = $1, updated_at = NOW()
             WHERE id = ANY($2::uuid[])`,
            [script_id, manualShoutoutIds],
          );
        }
      }

      // ── After first entry's song_intro: inject the opening station_id ───────────
      if (isFirst && segment_type === 'song_intro' && !openingStationIdInserted) {
        await reportProgress(
          10 + Math.round((segmentsDone / totalSegmentSlots) * 80),
          'Writing opening station ID…',
        );
        await generateNonSongSegment('station_id');
        openingStationIdInserted = true;
        // Reset so next periodic fires at stationIdIntervalSec from show start
        lastStationIdAtSec = 0;
      }
    }

    // Advance cumulative duration tracker for this song
    cumulativeSec += entry.duration_sec ?? 0;
  }

  // TTS is now generated on demand per-segment via POST /dj/segments/:id/tts
  // (removed from the generation job so scripts are available faster for review)

  await reportProgress(95, 'Finalising…');

  // 8. Update script with final segment count + generation time
  const generation_ms = Date.now() - start;
  await pool.query(
    `UPDATE dj_scripts
     SET total_segments = $2, generation_ms = $3, updated_at = NOW()
     WHERE id = $1`,
    [script_id, position, generation_ms],
  );

  // 9. Build manifest (fire-and-forget — failure does not block script)
  buildManifest(script_id).catch((err) =>
    console.error('[generationWorker] Manifest build failed:', err),
  );

  await reportProgress(100, 'Done');
}
