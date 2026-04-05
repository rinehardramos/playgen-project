import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ─── Env setup ───────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32-chars-minimum';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32-chars-minimum';
  process.env.JWT_ACCESS_EXPIRES_SEC = '900';
  process.env.JWT_REFRESH_EXPIRES_SEC = '604800';
});

// ─── Mock pg pool ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import { loginWithGoogle } from './oauthService';
import { AuthError } from './authService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUserRow(overrides: Partial<{
  id: string; company_id: string; role_id: string; role_code: string;
  role_permissions: string[]; email: string; display_name: string;
  password_hash: string | null; station_ids: string[]; is_active: boolean;
  oauth_provider: string | null; oauth_id: string | null;
}> = {}) {
  return {
    id: 'user-uuid-001',
    company_id: 'company-uuid-001',
    role_id: 'role-uuid-001',
    role_code: 'station_admin',
    role_permissions: ['playlist:read'],
    email: 'alice@example.com',
    display_name: 'Alice',
    password_hash: null,
    station_ids: ['station-1'],
    is_active: true,
    oauth_provider: 'google',
    oauth_id: 'google-sub-123',
    ...overrides,
  };
}

const googleProfile = {
  id: 'google-sub-123',
  email: 'alice@example.com',
  name: 'Alice',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('loginWithGoogle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns tokens and safe user for a returning OAuth user (matched by oauth_id)', async () => {
    const userRow = makeUserRow();

    // SELECT by oauth_id → found
    mockQuery
      .mockResolvedValueOnce({ rows: [userRow] })
      // UPDATE last_login_at
      .mockResolvedValueOnce({ rows: [] })
      // INSERT refresh_tokens
      .mockResolvedValueOnce({ rows: [] });

    const result = await loginWithGoogle(googleProfile);

    expect(result.tokens).toHaveProperty('access_token');
    expect(result.tokens).toHaveProperty('refresh_token');
    expect(result.user.id).toBe(userRow.id);
    expect(result.user.email).toBe(userRow.email);
    expect(result.user).not.toHaveProperty('password_hash');
    expect(result.user).not.toHaveProperty('role_id');
  });

  it('links account and returns tokens when user found by email (first OAuth login)', async () => {
    const userRow = makeUserRow({ oauth_provider: null, oauth_id: null });

    // SELECT by oauth_id → not found
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      // SELECT by email → found
      .mockResolvedValueOnce({ rows: [userRow] })
      // UPDATE to store oauth_id + last_login_at
      .mockResolvedValueOnce({ rows: [] })
      // INSERT refresh_tokens
      .mockResolvedValueOnce({ rows: [] });

    const result = await loginWithGoogle(googleProfile);

    expect(result.tokens).toHaveProperty('access_token');
    expect(result.user.email).toBe(userRow.email);

    // The UPDATE call should set oauth_provider and oauth_id
    const updateCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE users SET oauth_provider')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain(googleProfile.id);
  });

  it('throws OAUTH_NO_ACCOUNT when email has no matching PlayGen user', async () => {
    // SELECT by oauth_id → not found
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      // SELECT by email → not found
      .mockResolvedValueOnce({ rows: [] });

    await expect(loginWithGoogle({ id: 'new-sub', email: 'nobody@example.com', name: 'Nobody' }))
      .rejects.toMatchObject({
        code: 'OAUTH_NO_ACCOUNT',
      });
  });

  it('throws AuthError instance on OAUTH_NO_ACCOUNT', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(loginWithGoogle({ id: 'x', email: 'ghost@example.com', name: 'Ghost' }))
      .rejects.toBeInstanceOf(AuthError);
  });

  it('user result does not contain password_hash or role_id', async () => {
    const userRow = makeUserRow({ password_hash: '$2b$12$somehash' });

    mockQuery
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { user } = await loginWithGoogle(googleProfile);

    expect(user).not.toHaveProperty('password_hash');
    expect(user).not.toHaveProperty('role_id');
  });
});
