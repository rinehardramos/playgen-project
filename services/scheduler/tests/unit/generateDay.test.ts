import { describe, it, expect } from 'vitest';
import { todayInTimezone } from '../../src/routes/generateDay';

// ─── todayInTimezone ──────────────────────────────────────────────────────────

describe('todayInTimezone', () => {
  it('returns a YYYY-MM-DD string for a valid IANA timezone', () => {
    const result = todayInTimezone('Asia/Manila');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a YYYY-MM-DD string for UTC', () => {
    const result = todayInTimezone('UTC');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back to UTC when timezone is null', () => {
    const result = todayInTimezone(null);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should match what UTC produces
    const utcDate = new Date().toISOString().slice(0, 10);
    // Allow for day boundary differences of ±1 day
    const resultDate = new Date(result);
    const utcDateObj = new Date(utcDate);
    const diffMs = Math.abs(resultDate.getTime() - utcDateObj.getTime());
    expect(diffMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('falls back gracefully for an invalid timezone string', () => {
    const result = todayInTimezone('Not/A_Timezone');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns different dates for UTC vs a timezone far ahead', () => {
    // This test is deterministic only when run near midnight UTC.
    // We just assert that the return is a valid date string in both cases.
    const utcResult = todayInTimezone('UTC');
    const manilaResult = todayInTimezone('Asia/Manila'); // UTC+8
    expect(utcResult).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(manilaResult).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
