/**
 * Soft rate limiting for LLM and TTS usage, checked against dj_usage_log.
 *
 * Limits are read from station_settings keys:
 *   - `llm_calls_per_day`  (integer, default: unlimited)
 *   - `tts_chars_per_day`  (integer, default: unlimited)
 *
 * When a limit is hit the caller receives { allowed: false, reason: string }
 * so it can skip the call gracefully rather than hard-failing.
 */
import { getPool } from '../db.js';

export interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether the station is allowed to make another LLM call today.
 * Reads today's LLM call count from dj_usage_log and compares against
 * the `llm_calls_per_day` station_setting (if set).
 */
export async function checkLlmRateLimit(stationId: string): Promise<RateLimitCheck> {
  const pool = getPool();

  // Load limit from station_settings
  const { rows: settingRows } = await pool.query<{ value: string }>(
    `SELECT value FROM station_settings
     WHERE station_id = $1 AND key = 'llm_calls_per_day'`,
    [stationId],
  );

  const limitStr = settingRows[0]?.value;
  if (!limitStr) return { allowed: true }; // No limit configured

  const limit = parseInt(limitStr, 10);
  if (isNaN(limit) || limit <= 0) return { allowed: true };

  // Count today's LLM calls for this station (UTC day boundary)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM dj_usage_log
     WHERE station_id = $1
       AND usage_type = 'llm'
       AND created_at >= $2`,
    [stationId, todayStart.toISOString()],
  );

  const used = parseInt(countRows[0]?.count ?? '0', 10);

  if (used >= limit) {
    return {
      allowed: false,
      reason: `LLM rate limit reached: ${used}/${limit} calls today. Increase llm_calls_per_day in station settings to allow more.`,
    };
  }

  return { allowed: true };
}

/**
 * Check whether the station is allowed to generate more TTS characters today.
 * Reads today's character count from dj_usage_log and compares against
 * the `tts_chars_per_day` station_setting (if set).
 */
export async function checkTtsRateLimit(
  stationId: string,
  pendingChars: number,
): Promise<RateLimitCheck> {
  const pool = getPool();

  // Load limit from station_settings
  const { rows: settingRows } = await pool.query<{ value: string }>(
    `SELECT value FROM station_settings
     WHERE station_id = $1 AND key = 'tts_chars_per_day'`,
    [stationId],
  );

  const limitStr = settingRows[0]?.value;
  if (!limitStr) return { allowed: true }; // No limit configured

  const limit = parseInt(limitStr, 10);
  if (isNaN(limit) || limit <= 0) return { allowed: true };

  // Count today's TTS characters for this station
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { rows: countRows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(character_count), 0) AS total
     FROM dj_usage_log
     WHERE station_id = $1
       AND usage_type = 'tts'
       AND created_at >= $2`,
    [stationId, todayStart.toISOString()],
  );

  const used = parseInt(countRows[0]?.total ?? '0', 10);

  if (used + pendingChars > limit) {
    return {
      allowed: false,
      reason: `TTS rate limit reached: ${used} chars used today (limit ${limit}). Increase tts_chars_per_day in station settings to allow more.`,
    };
  }

  return { allowed: true };
}
