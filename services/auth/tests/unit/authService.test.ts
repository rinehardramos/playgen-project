import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock resend so `new Resend()` doesn't throw when authService imports emailService
vi.mock('resend', () => {
  class ResendMock {
    emails = { send: vi.fn().mockResolvedValue({ id: 'stub' }) };
  }
  return { Resend: ResendMock };
});

import { AuthError } from '../../src/services/authService';

// Unit tests for AuthError — isolated from DB
describe('AuthError', () => {
  it('has correct code and message', () => {
    const err = new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    expect(err.code).toBe('INVALID_CREDENTIALS');
    expect(err.message).toBe('Invalid email or password');
    expect(err.name).toBe('AuthError');
    expect(err).toBeInstanceOf(Error);
  });

  it('is distinguishable from generic Error', () => {
    const err = new AuthError('INVALID_TOKEN', 'Token expired');
    expect(err instanceof AuthError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

// Token hash determinism (pure function — no DB needed)
describe('token hashing', () => {
  it('same token always produces same hash', async () => {
    const crypto = await import('crypto');
    const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
    const token = 'some.jwt.token';
    expect(hash(token)).toBe(hash(token));
  });

  it('different tokens produce different hashes', async () => {
    const crypto = await import('crypto');
    const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
    expect(hash('token-a')).not.toBe(hash('token-b'));
  });
});
