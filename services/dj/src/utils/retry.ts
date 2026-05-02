/**
 * Retry helper for transient LLM / TTS API errors.
 *
 * Retries on rate-limit (429) and server-error (5xx) responses with
 * exponential back-off. Non-retryable errors (4xx except 429) are
 * rethrown immediately.
 */

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  label?: string;
}

/** Returns true if the error message looks like a retryable transient failure. */
function isRetryable(err: Error): boolean {
  const msg = err.message;
  return /42[79]|5\d{2}|rate.?limit|too many requests|upstream|overload/i.test(msg);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, initialDelayMs = 1000, label = 'op' } = opts;
  let lastErr: Error = new Error('no attempts');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err as Error;
      if (!isRetryable(lastErr) || attempt === maxAttempts) {
        throw lastErr;
      }
      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `[retry] ${label} attempt ${attempt}/${maxAttempts} failed: ${lastErr.message} — retrying in ${delay}ms`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
