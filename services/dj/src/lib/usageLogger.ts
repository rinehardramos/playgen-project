/**
 * Lightweight fire-and-forget helpers for logging LLM token usage and TTS
 * character usage to the dj_usage_log table.
 *
 * All functions are non-blocking — failures are caught and logged to stderr
 * rather than surfaced to callers.
 */
import { getPool } from '../db.js';
import type { LlmUsage } from '../adapters/llm/openrouter.js';

// ── Cost estimate tables (USD per 1 M tokens / 1 M characters) ───────────────
// Source: public provider pricing pages (approximate, 2025-04 snapshot).
// Update when provider pricing changes — these are used for estimates only.

const LLM_COST_PER_1M: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o':               { input: 5.00,  output: 15.00 },
  'gpt-4o-mini':          { input: 0.15,  output: 0.60  },
  'gpt-4-turbo':          { input: 10.00, output: 30.00 },
  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 3.00,  output: 15.00 },
  'claude-3-5-haiku-20241022':  { input: 0.80,  output: 4.00  },
  'claude-sonnet-4-5':          { input: 3.00,  output: 15.00 },
  // OpenRouter pass-through — use same keys after stripping vendor prefix
  'anthropic/claude-3-5-sonnet-20241022': { input: 3.00,  output: 15.00 },
  'anthropic/claude-3-5-haiku-20241022':  { input: 0.80,  output: 4.00  },
  'anthropic/claude-sonnet-4-5':          { input: 3.00,  output: 15.00 },
  'openai/gpt-4o':        { input: 5.00,  output: 15.00 },
  'openai/gpt-4o-mini':   { input: 0.15,  output: 0.60  },
  // Google Gemini
  'gemini-2.0-flash':     { input: 0.075, output: 0.30  },
  'gemini-1.5-pro':       { input: 1.25,  output: 5.00  },
  // Mistral
  'mistral-large-latest': { input: 4.00,  output: 12.00 },
  'mistral-small-latest': { input: 0.10,  output: 0.30  },
};

/** USD per 1 M characters, by TTS provider. */
const TTS_COST_PER_1M_CHARS: Record<string, number> = {
  openai:      15.00,  // TTS-1 standard
  elevenlabs:  0.18,   // paid plan estimate (per-char)
  google:      16.00,  // Google Cloud TTS Wavenet
  gemini_tts:  16.00,  // Gemini native TTS (same Google infra)
  mistral:     0.00,   // Mistral has no native TTS — placeholder
};

function estimateLlmCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | undefined {
  const pricing = LLM_COST_PER_1M[model];
  if (!pricing) return undefined;
  return (
    (promptTokens / 1_000_000) * pricing.input +
    (completionTokens / 1_000_000) * pricing.output
  );
}

function estimateTtsCost(provider: string, charCount: number): number {
  const rate = TTS_COST_PER_1M_CHARS[provider] ?? 0;
  return (charCount / 1_000_000) * rate;
}

// ── Log helpers ───────────────────────────────────────────────────────────────

export interface LogLlmUsageParams {
  station_id: string;
  script_id: string;
  segment_id?: string;
  provider: string;
  model: string;
  usage: LlmUsage;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget: insert one LLM usage row into dj_usage_log.
 * Any DB error is caught and printed to stderr; never throws.
 */
export function logLlmUsage(params: LogLlmUsageParams): void {
  const cost = estimateLlmCost(
    params.model,
    params.usage.prompt_tokens,
    params.usage.completion_tokens,
  );

  getPool()
    .query(
      `INSERT INTO dj_usage_log
         (station_id, script_id, segment_id, usage_type, provider, model,
          prompt_tokens, completion_tokens, total_tokens, cost_usd, metadata)
       VALUES ($1,$2,$3,'llm',$4,$5,$6,$7,$8,$9,$10)`,
      [
        params.station_id,
        params.script_id,
        params.segment_id ?? null,
        params.provider,
        params.model,
        params.usage.prompt_tokens,
        params.usage.completion_tokens,
        params.usage.total_tokens,
        cost ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ],
    )
    .catch((err) => {
      console.error('[usageLogger] Failed to insert LLM usage log:', err);
    });
}

export interface LogTtsUsageParams {
  station_id: string;
  script_id: string;
  segment_id?: string;
  provider: string;
  character_count: number;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget: insert one TTS usage row into dj_usage_log.
 * Any DB error is caught and printed to stderr; never throws.
 */
export function logTtsUsage(params: LogTtsUsageParams): void {
  const cost = estimateTtsCost(params.provider, params.character_count);

  getPool()
    .query(
      `INSERT INTO dj_usage_log
         (station_id, script_id, segment_id, usage_type, provider,
          character_count, cost_usd, metadata)
       VALUES ($1,$2,$3,'tts',$4,$5,$6,$7)`,
      [
        params.station_id,
        params.script_id,
        params.segment_id ?? null,
        params.provider,
        params.character_count,
        cost ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ],
    )
    .catch((err) => {
      console.error('[usageLogger] Failed to insert TTS usage log:', err);
    });
}
