import { getPool } from '../db.js';
import { getSocialProviders } from '../adapters/social/index.js';
import { llmComplete } from '../adapters/llm/index.js';
import { buildSystemPrompt, buildDualDjSystemPrompt, buildMultiDjSystemPrompt, buildUserPrompt } from '../lib/promptBuilder.js';
import type { StationIdentity } from '../lib/promptBuilder.js';
import { logLlmUsage } from '../lib/usageLogger.js';
import { checkLlmRateLimit } from '../lib/rateLimiter.js';
import { getInfoBrokerClient } from '../lib/infoBroker.js';
import { sanitizeUntrusted } from '../lib/promptGuard.js';
import type { WeatherResponse, NewsResponse, JokeResponse } from '@playgen/info-broker-client';
import { config } from '../config.js';
import { buildManifest } from '../services/manifestService.js';
// ttsService imported lazily in autoTriggerTts() to avoid module-level storage init in tests
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
  // API keys are resolved from station_settings (multi-tenant) or env vars (fallback).
  // Per-station column keys were removed — use station_settings['llm_api_key'] etc.
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

  // 2. Load DJ profile(s)
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

  // 2a. Load secondary and tertiary DJ profiles for multi-DJ dialogue
  let secondaryProfile: DjProfile | null = null;
  if (data.secondary_dj_profile_id) {
    const { rows } = await pool.query<DjProfile>(
      `SELECT * FROM dj_profiles WHERE id = $1`,
      [data.secondary_dj_profile_id],
    );
    secondaryProfile = rows[0] ?? null;
  }
  let tertiaryProfile: DjProfile | null = null;
  if (data.tertiary_dj_profile_id) {
    const { rows } = await pool.query<DjProfile>(
      `SELECT * FROM dj_profiles WHERE id = $1`,
      [data.tertiary_dj_profile_id],
    );
    tertiaryProfile = rows[0] ?? null;
  }
  const isDualDj = !!secondaryProfile;
  const allProfiles: DjProfile[] = [
    profile,
    ...(secondaryProfile ? [secondaryProfile] : []),
    ...(tertiaryProfile ? [tertiaryProfile] : []),
  ];

  // 2b. Pre-flight: fail fast if no LLM API key is available before creating any DB records.
  //     Both per-station keys (from station columns / station_settings) and env var defaults
  //     are checked so the error message tells the operator exactly what to configure.
  // Multi-tenant key resolution: station_settings first, env var fallback.
  const earlyLlmProvider = stationSettings['llm_provider'] ?? config.llm.provider;
  const earlyLlmApiKey = stationSettings['llm_api_key'] ?? undefined;
  const earlyLlmFallback =
    earlyLlmProvider === 'openai'
      ? config.llm.openaiApiKey
      : earlyLlmProvider === 'anthropic'
      ? config.llm.anthropicApiKey
      : earlyLlmProvider === 'gemini'
      ? config.llm.geminiApiKey
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

  // 4d. Fetch social mentions via broker (replaces direct Twitter/Facebook adapter calls).
  //     Outbound publish + OAuth callbacks remain in DJ adapters.
  interface SocialShoutout { listener_name: string | null; message: string; }
  const socialShoutouts: SocialShoutout[] = [];
  if (broker) {
    try {
      const mentionsResult = await broker.getSocialMentions({
        platform: 'twitter',
        ownerRef: `station:${data.station_id}`,
        limit: 10,
      });
      for (const mention of mentionsResult?.mentions ?? []) {
        socialShoutouts.push({
          listener_name: mention.author_name ?? mention.author_handle ?? null,
          message: mention.text,
        });
      }
    } catch (err) {
      console.warn('[generationWorker] Broker social mentions fetch failed (non-fatal):', err);
    }
  } else {
    // Fallback: direct social provider adapters (legacy, for when broker is not configured)
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
  }

  // Merge manual shoutouts with social posts (manual first, then social, max 3 total)
  const allListenerContent: ShoutoutRow[] = [
    ...pendingShoutouts,
    ...socialShoutouts
      .filter((s) => !pendingShoutouts.some((p) => p.message === s.message))
      .map((s) => ({ id: '', listener_name: s.listener_name, message: s.message })),
  ].slice(0, 3);

  // 5. Create the script record (with multi-DJ fields when applicable)
  const voiceMap = isDualDj
    ? (data.voice_map ?? Object.fromEntries(allProfiles.map((p) => [p.name, p.tts_voice_id])))
    : null;

  const { rows: scriptRows } = await pool.query(
    `INSERT INTO dj_scripts
       (playlist_id, station_id, dj_profile_id, secondary_dj_profile_id,
        review_status, llm_model, total_segments, voice_map)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
     RETURNING id`,
    [
      data.playlist_id,
      data.station_id,
      profile.id,
      secondaryProfile?.id ?? null,
      data.auto_approve ? 'auto_approved' : 'pending_review',
      profile.llm_model,
      voiceMap ? JSON.stringify(voiceMap) : null,
    ],
  );
  const script_id: string = scriptRows[0].id;

  // 5b. Load program themes for this station/hour and resolve directives
  const { resolveThemeDirectives, formatDirectivesForSegment } = await import('../lib/themeResolver.js');
  let themeDirectivesResolved: ReturnType<typeof resolveThemeDirectives> | null = null;
  try {
    const { rows: programRows } = await pool.query<{ themes: import('@playgen/types').ProgramTheme[] | null }>(
      `SELECT themes FROM programs
       WHERE station_id = $1 AND is_active = TRUE AND themes IS NOT NULL AND themes != '[]'::jsonb
       ORDER BY is_default ASC LIMIT 1`,
      [data.station_id],
    );
    const themes = programRows[0]?.themes;
    if (themes && themes.length > 0) {
      themeDirectivesResolved = resolveThemeDirectives(themes, {
        weather: weatherData ?? undefined,
        news_items: newsData?.items ?? undefined,
        total_segments: entries.length * 2, // approximate
      });
    }
  } catch (err) {
    console.warn('[generationWorker] Theme resolution failed (non-fatal):', err);
  }

  // 6. Generate segments
  const currentDate = new Date().toISOString().split('T')[0];
  let position = 0;

  // Resolve effective LLM config (TTS is now generated on-demand per segment)
  const effectiveLlmProvider = stationSettings['llm_provider'] ?? config.llm.provider;
  const effectiveLlmModel    = stationSettings['llm_model'] || profile.llm_model;

  const effectiveLlmApiKey =
    stationSettings['llm_api_key'] ??
    (effectiveLlmProvider === 'openai'
      ? config.llm.openaiApiKey || undefined
      : effectiveLlmProvider === 'anthropic'
      ? config.llm.anthropicApiKey || undefined
      : effectiveLlmProvider === 'gemini'
      ? config.llm.geminiApiKey || undefined
      : config.openRouter.apiKey || undefined);

  const effectiveTtsProvider = (stationSettings['tts_provider'] ?? config.tts.provider) as string;
  const effectiveTtsApiKey = stationSettings['tts_api_key']
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
      themeDirectives: themeDirectivesResolved
        ? formatDirectivesForSegment(themeDirectivesResolved, position)
        : undefined,
    };
    const systemPrompt = isDualDj
      ? buildMultiDjSystemPrompt(allProfiles, station.locale_code, effectiveTtsProvider)
      : buildSystemPrompt(profile!, station.locale_code, effectiveTtsProvider);
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
    const nonSongSpeaker = isDualDj
      ? (script_text.match(/^\[([^\]]+)\]/)?.[1] ?? profile!.name)
      : null;
    const pos = position++;
    const segResult = await pool.query(
      `INSERT INTO dj_segments
         (script_id, playlist_entry_id, segment_type, position, script_text, speaker)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [script_id, null, segment_type, pos, script_text, nonSongSpeaker],
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
        themeDirectives: themeDirectivesResolved
          ? formatDirectivesForSegment(themeDirectivesResolved, position)
          : undefined,
      };

      const systemPrompt = isDualDj
        ? buildMultiDjSystemPrompt(allProfiles, station.locale_code, effectiveTtsProvider)
        : buildSystemPrompt(profile, station.locale_code, effectiveTtsProvider);
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

      // For dual-DJ, detect the primary speaker from [Name] tags
      const speakerTag = isDualDj
        ? (script_text.match(/^\[([^\]]+)\]/)?.[1] ?? profile.name)
        : null;

      const pos = position++;
      const segResult = await pool.query(
        `INSERT INTO dj_segments
           (script_id, playlist_entry_id, segment_type, position, script_text, speaker)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [script_id, entry.id, segment_type, pos, script_text, speakerTag],
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
            themeDirectives: themeDirectivesResolved
              ? formatDirectivesForSegment(themeDirectivesResolved, position)
              : undefined,
          };

          const shoutoutSystemPrompt = isDualDj
            ? buildMultiDjSystemPrompt(allProfiles, station.locale_code, effectiveTtsProvider)
            : buildSystemPrompt(profile, station.locale_code, effectiveTtsProvider);
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

  // 10. Inject floating DJ segments over songs (dynamic layered audio)
  await injectFloatingSegments({
    scriptId: script_id,
    stationId: data.station_id,
    playlistId: data.playlist_id,
    entries,
    allProfiles,
    isDualDj,
    profile: profile!,
    station,
    effectiveLlmModel,
    effectiveLlmApiKey,
    effectiveLlmProvider,
    effectiveTtsProvider,
    pool,
  });

  // 11. Auto-trigger TTS if script is auto-approved (pipeline automation)
  if (data.auto_approve) {
    autoTriggerTts(script_id, data.station_id).catch((err) =>
      console.error('[auto-pipeline] Auto-TTS failed:', err),
    );
  }
}

// ── Floating segment injection ─────────────────────────────────────────────

interface FloatingSegmentOpts {
  scriptId: string;
  stationId: string;
  playlistId: string;
  entries: PlaylistEntryRow[];
  allProfiles: DjProfile[];
  isDualDj: boolean;
  profile: DjProfile;
  station: StationRow;
  effectiveLlmModel: string;
  effectiveLlmApiKey: string | null;
  effectiveLlmProvider: string;
  effectiveTtsProvider: string;
  pool: ReturnType<typeof getPool>;
}

/**
 * Inject floating DJ segments that play *over* songs rather than between them.
 *
 * Each song gets a randomised chance of:
 *  - A mid-song adlib (40% chance) — spontaneous energy drop or station promo
 *  - A near-end overlap (60% chance) — DJ starts talking before song ends
 *
 * Floating segments carry `start_offset_sec` (seconds into the song) and
 * `anchor_playlist_entry_id` so the HLS builder can place them on the DJ track
 * at the correct program-timeline offset.
 *
 * Runs after sequential segments are committed — does not affect position counter.
 */
async function injectFloatingSegments(opts: FloatingSegmentOpts): Promise<void> {
  const {
    scriptId, stationId, entries, allProfiles, isDualDj, profile,
    station, effectiveLlmModel, effectiveLlmApiKey, effectiveLlmProvider,
    effectiveTtsProvider, pool,
  } = opts;

  if (entries.length === 0) return;

  // Station-level sponsor name for mid-song promos (falls through to generic if absent)
  const { rows: settingRows } = await pool.query<{ value: string }>(
    `SELECT value FROM station_settings WHERE station_id = $1 AND key = 'sponsor_name'`,
    [stationId],
  );
  const sponsorName = settingRows[0]?.value ?? null;

  const systemPrompt = isDualDj
    ? buildMultiDjSystemPrompt(allProfiles, station.locale_code, effectiveTtsProvider)
    : buildSystemPrompt(profile, station.locale_code, effectiveTtsProvider);

  let injected = 0;

  for (const entry of entries) {
    const durationSec = entry.duration_sec ?? 180;

    // Skip very short tracks (jingles, station IDs < 30s) — no room for overlay
    if (durationSec < 30) continue;

    // ── Mid-song adlib (40% per song, not first or last song) ────────────────
    const isFirstOrLast = entry.position === 0 || entry.position === entries.length - 1;
    if (!isFirstOrLast && Math.random() < 0.4) {
      // Place between 20% and 60% into the song for a natural mid-point feel
      const minOffset = Math.floor(durationSec * 0.2);
      const maxOffset = Math.floor(durationSec * 0.6);
      const offset = minOffset + Math.floor(Math.random() * (maxOffset - minOffset + 1));

      // Alternate between spontaneous adlib and station promo
      const isSponsor = sponsorName && Math.random() < 0.35;
      const userMsg = isSponsor
        ? `Drop a quick mid-song sponsor mention for "${sponsorName}". One sentence, natural and energetic — like you just remembered to say it.`
        : `Drop a quick spontaneous mid-song comment — an adlib, a fun reaction, or a playful observation. One or two short sentences. Sound like it just came to you naturally.`;

      try {
        const result = await llmComplete(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
          { model: effectiveLlmModel, temperature: 0.95, apiKey: effectiveLlmApiKey ?? undefined, provider: effectiveLlmProvider },
        );
        await pool.query(
          `INSERT INTO dj_segments
             (script_id, anchor_playlist_entry_id, segment_type, position, script_text,
              start_offset_sec)
           VALUES ($1, $2, 'adlib', -1, $3, $4)`,
          [scriptId, entry.id, result.text, offset],
        );
        injected++;
      } catch (err) {
        console.warn('[floating] Mid-song adlib LLM failed:', err);
      }
    }

    // ── Near-end overlap (60% per song, last 20–30s) ─────────────────────────
    if (Math.random() < 0.6) {
      const overlapWindow = Math.min(30, Math.floor(durationSec * 0.15));
      const offset = durationSec - overlapWindow - Math.floor(Math.random() * 8);

      const isLastSong = entry.position === entries.length - 1;
      const nextEntry = isLastSong ? null : entries[entry.position + 1];
      const nextInfo = nextEntry
        ? ` The next song coming up is "${nextEntry.song_title}" by ${nextEntry.song_artist}.`
        : '';

      const userMsg = `"${entry.song_title}" by ${entry.song_artist} is about to end.${nextInfo} Bridge naturally into what's next — or just keep the energy going. One to two sentences, like you're jumping in before the fade.`;

      try {
        const result = await llmComplete(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
          { model: effectiveLlmModel, temperature: 0.9, apiKey: effectiveLlmApiKey ?? undefined, provider: effectiveLlmProvider },
        );
        await pool.query(
          `INSERT INTO dj_segments
             (script_id, anchor_playlist_entry_id, segment_type, position, script_text,
              start_offset_sec)
           VALUES ($1, $2, 'song_transition', -1, $3, $4)`,
          [scriptId, entry.id, result.text, Math.max(0, offset)],
        );
        injected++;
      } catch (err) {
        console.warn('[floating] Near-end overlap LLM failed:', err);
      }
    }
  }

  if (injected > 0) {
    console.info(`[floating] Injected ${injected} floating segments for script ${scriptId}`);
  }
}

/**
 * Auto-trigger TTS for all segments after generation completes (auto-approve only).
 * Runs in background — does not block the generation worker response.
 */
async function autoTriggerTts(scriptId: string, stationId: string): Promise<void> {
  // Lazy import to avoid module-level storage initialization (breaks unit tests)
  const { generateSegmentTts, generateDialogueTts, isDialogueText, loadTtsProviderConfig } =
    await import('../services/ttsService.js');
  const pool = getPool();
  console.info(`[auto-pipeline] Auto-triggering TTS for script ${scriptId}`);

  // Load TTS config + voice_map (needed for multi-DJ dialogue segments)
  const { rows: profileRows } = await pool.query<{
    tts_voice_id: string; voice_map: Record<string, string> | null;
  }>(
    `SELECT dp.tts_voice_id, ds.voice_map
     FROM dj_scripts ds JOIN dj_profiles dp ON dp.id = ds.dj_profile_id
     WHERE ds.id = $1`,
    [scriptId],
  );
  const fallbackVoiceId = profileRows[0]?.tts_voice_id ?? 'alloy';
  const voiceMap = profileRows[0]?.voice_map ?? null;
  const providerCfg = await loadTtsProviderConfig(stationId, fallbackVoiceId);
  if (!providerCfg) {
    console.warn('[auto-pipeline] TTS not configured for station, skipping auto-TTS');
    return;
  }

  // Load pending segments
  const { rows: segments } = await pool.query<{
    id: string; position: number; script_text: string; edited_text: string | null;
  }>(
    `SELECT id, position, script_text, edited_text
     FROM dj_segments WHERE script_id = $1 AND audio_url IS NULL
     ORDER BY position`,
    [scriptId],
  );

  if (segments.length === 0) {
    console.info('[auto-pipeline] No segments need TTS');
    return;
  }

  // ElevenLabs free/starter plans cap at 3 concurrent requests; default to 2 to stay safe.
  const concurrency = Math.max(1, parseInt(process.env.TTS_WORKER_CONCURRENCY ?? '2', 10));
  let generated = 0;
  let failed = 0;

  for (let i = 0; i < segments.length; i += concurrency) {
    const batch = segments.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((seg) => {
        const text = seg.edited_text ?? seg.script_text;
        const segInput = {
          id: seg.id,
          position: seg.position,
          text,
          script_id: scriptId,
          station_id: stationId,
        };
        // Multi-DJ dialogue: use per-speaker voice synthesis + ffmpeg concat
        if (voiceMap && isDialogueText(text)) {
          return generateDialogueTts(segInput, providerCfg, voiceMap);
        }
        return generateSegmentTts(segInput, providerCfg);
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') generated++;
      else {
        failed++;
        console.warn('[auto-pipeline] Segment TTS failed:', result.reason);
      }
    }
  }

  console.info(`[auto-pipeline] TTS complete — generated=${generated} failed=${failed}`);

  // Auto-trigger publish if all TTS succeeded
  if (failed === 0) {
    autoTriggerPublish(scriptId, stationId).catch((err) =>
      console.error('[auto-pipeline] Auto-publish trigger failed:', err),
    );
  } else {
    console.warn(`[auto-pipeline] ${failed} TTS failures — skipping auto-publish`);
  }
}

/**
 * Auto-trigger the publish pipeline after TTS completes successfully.
 * Calls the station service's publish endpoint via internal HTTP.
 */
async function autoTriggerPublish(scriptId: string, stationId: string): Promise<void> {
  const stationBase = process.env.STATION_INTERNAL_URL ?? 'http://station:3002';
  const prodGateway = process.env.PROD_GATEWAY_URL;
  if (!prodGateway) {
    console.info('[auto-pipeline] PROD_GATEWAY_URL not set — skipping auto-publish');
    return;
  }

  console.info(`[auto-pipeline] Triggering publish for script ${scriptId}`);

  // Get a service token for the station service
  const authBase = process.env.AUTH_INTERNAL_URL ?? 'http://auth:3001';
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[auto-pipeline] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping auto-publish');
    return;
  }

  const loginRes = await fetch(`${authBase}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    console.error(`[auto-pipeline] Service login failed: ${loginRes.status}`);
    return;
  }
  const loginData = await loginRes.json() as { tokens?: { access_token: string }; access_token?: string };
  const token = loginData.tokens?.access_token ?? loginData.access_token;
  if (!token) {
    console.error('[auto-pipeline] Service login response missing access_token');
    return;
  }

  const res = await fetch(`${stationBase}/api/v1/programs/${scriptId}/publish`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[auto-pipeline] Publish failed (${res.status}): ${body}`);
    return;
  }

  const data = await res.json() as { publish_job_id?: string };
  console.info(`[auto-pipeline] Publish enqueued — job=${data.publish_job_id}`);
}
