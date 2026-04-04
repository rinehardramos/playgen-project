import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32-chars-minimum';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32-chars-minimum';
  process.env.APP_URL = 'http://localhost:3000';
});

const mockQuery = vi.fn();

vi.mock('../db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import { acceptInvite, AuthError } from './authService';

describe('acceptInvite', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('throws INVALID_TOKEN when invite not found or expired', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(acceptInvite('bad-token', 'Test User', 'password123')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'INVALID_TOKEN',
    });
  });

  it('throws EMAIL_TAKEN when user already exists with that email', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'invite-001',
          company_id: 'company-001',
          role_id: 'role-001',
          email: 'existing@example.com',
          station_ids: [],
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-user' }] });

    await expect(acceptInvite('valid-token', 'Test User', 'password123')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'EMAIL_TAKEN',
    });
  });

  it('creates user, marks invite accepted, and returns tokens on valid invite', async () => {
    const newUserId = 'new-user-uuid-001';

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'invite-001',
          company_id: 'company-001',
          role_id: 'role-001',
          email: 'new@example.com',
          station_ids: ['station-001'],
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: newUserId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: newUserId,
          company_id: 'company-001',
          role_id: 'role-001',
          role_code: 'scheduler',
          role_permissions: [],
          email: 'new@example.com',
          display_name: 'New User',
          password_hash: 'hashed',
          station_ids: ['station-001'],
          is_active: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await acceptInvite('valid-token', 'New User', 'password123');

    expect(result.tokens).toHaveProperty('access_token');
    expect(result.tokens).toHaveProperty('refresh_token');
    expect(result.user.email).toBe('new@example.com');
    expect(result.user).not.toHaveProperty('password_hash');
  });

  it('throws AuthError instance for invalid token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(acceptInvite('expired-token', 'User', 'password123')).rejects.toBeInstanceOf(AuthError);
  });
});
