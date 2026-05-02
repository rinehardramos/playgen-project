import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/utils/retry';

// Speed up tests by replacing setTimeout
vi.useFakeTimers();

describe('withRetry', () => {
  it('returns result immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { label: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 rate-limit error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { maxAttempts: 3, label: 'llm' });
    // Advance past the backoff delay
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error (400 bad request)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 400 Bad Request'));
    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts maxAttempts and rethrows last retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 429 rate limit'));
    const promise = withRetry(fn, { maxAttempts: 3, label: 'tts' });
    // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
    const errorPromise = expect(promise).rejects.toThrow('429');
    await vi.runAllTimersAsync();
    await errorPromise;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on 503 server error', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream 503 Service Unavailable'))
      .mockRejectedValueOnce(new Error('upstream 503 Service Unavailable'))
      .mockResolvedValue('recovered');

    const promise = withRetry(fn, { maxAttempts: 3, label: 'tts' });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
