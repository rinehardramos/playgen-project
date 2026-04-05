import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '../../src/services/authService';

// Mock dependencies
vi.mock('../../src/db', () => ({
  getPool: vi.fn().mockReturnValue({
    query: vi.fn(),
  }),
}));

vi.mock('../../src/services/emailService', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getPool } from '../../src/db';

describe('verifyEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws INVALID_TOKEN when token not found', async () => {
    const mockPool = getPool();
    (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    const { verifyEmail } = await import('../../src/services/authService');
    await expect(verifyEmail('bad-token')).rejects.toThrow(AuthError);
  });

  it('marks email_verified_at when token is valid', async () => {
    const mockPool = getPool();
    // First query: find token
    (mockPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ id: 'token-uuid', user_id: 'user-uuid' }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users
      .mockResolvedValueOnce({ rows: [] }); // UPDATE tokens

    const { verifyEmail } = await import('../../src/services/authService');
    await expect(verifyEmail('valid-token')).resolves.toBeUndefined();

    const updateUsersCall = (mockPool.query as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(updateUsersCall[0]).toContain('email_verified_at');
  });
});
