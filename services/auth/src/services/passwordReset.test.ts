import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ─── Env setup ────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32-chars-minimum';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32-chars-minimum';
  process.env.APP_URL = 'http://localhost:3000';
});

// ─── Mock pg pool ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import { forgotPassword, resetPassword, AuthError } from './authService';

// ─── forgotPassword ───────────────────────────────────────────────────────────

describe('forgotPassword', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns silently when no user found (avoids user enumeration)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(forgotPassword('unknown@example.com')).resolves.toBeUndefined();
    expect(mockQuery.mock.calls.length).toBe(1);
  });

  it('creates a reset token and logs a link for a valid user', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-001', email: 'test@example.com' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await forgotPassword('test@example.com');

    expect(mockQuery.mock.calls.length).toBe(3);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('reset-password?token='));
    consoleSpy.mockRestore();
  });
});

// ─── resetPassword ────────────────────────────────────────────────────────────

describe('resetPassword', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('throws INVALID_TOKEN when token not found or expired', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(resetPassword('bad-token', 'newpassword123')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'INVALID_TOKEN',
    });
  });

  it('updates password hash and marks token used on valid token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'token-uuid-001', user_id: 'user-uuid-001' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(resetPassword('valid-token-string', 'newpassword123')).resolves.toBeUndefined();

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE users SET password_hash');

    const markUsedCall = mockQuery.mock.calls[2];
    expect(markUsedCall[0]).toContain('UPDATE password_reset_tokens SET used_at');
  });

  it('revokes all existing refresh tokens on password reset', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'token-uuid-001', user_id: 'user-uuid-001' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await resetPassword('valid-token-string', 'newpassword123');

    const revokeCall = mockQuery.mock.calls[3];
    expect(revokeCall[0]).toContain('UPDATE refresh_tokens SET revoked_at');
  });

  it('throws AuthError instance for invalid token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(resetPassword('expired-token', 'newpassword123')).rejects.toBeInstanceOf(AuthError);
  });
});
