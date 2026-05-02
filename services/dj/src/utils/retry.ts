/**
 * Exponential backoff retry utility for transient LLM/TTS provider errors.
 *
 * Retries on 429 (rate limit) and 5xx (server error) responses.
 * Non-retryable errors (400, 401, 404, etc.) are rethrown immediately.
 */

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/** True for errors that are worth retrying (rate limits, transient server errors). */
function isRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('quota') ||
    msg.includes('insufficient credits') ||
    msg.includes('retry-after') ||
    msg.includes('overloaded')
  );
}

/** Parse Retry-After delay from an error message (returns ms or null). */
function parseRetryAfterMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/retry.?after[:\s]+(\d+)/i);
  if (m) return Math.min(parseInt(m[1], 10) * 1_000, MAX_DELAY_MS);
  return null;
}

/**
 * Retry `fn` up to `maxAttempts` times with exponential backoff + jitter.
 * Non-retryable errors are rethrown immediately (no retry delay wasted).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, label = 'call' }: { maxAttempts?: number; label?: string } = {},
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || attempt === maxAttempts) throw err;
      const retryAfterMs = parseRetryAfterMs(err);
      const backoffMs = retryAfterMs ?? Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      const jitter = Math.random() * 500;
      const delayMs = Math.round(backoffMs + jitter);
      console.warn(
        `[retry] ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${(err as Error).message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable — last iteration always throws
  throw new Error(`[retry] ${label} exhausted ${maxAttempts} attempts`);
}
