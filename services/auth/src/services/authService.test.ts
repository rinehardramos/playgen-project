import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';

// ─── Env setup (must precede module imports) ─────────────────────────────────

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-32-chars-minimum';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32-chars-minimum';
  process.env.JWT_ACCESS_EXPIRES_SEC = '900';
  process.env.JWT_REFRESH_EXPIRES_SEC = '604800';
});

// ─── Mock pg pool ─────────────────────────────────────────────────────────────
// The mock must be declared before importing authService so that when
// authService.ts evaluates `import { getPool } from '../db'` it receives
// the mock implementation.

const mockQuery = vi.fn();

vi.mock('../db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// Import authService after the mock is in place.
import { login, AuthError, issueTokenPair } from './authService';
import jwt from 'jsonwebtoken';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a realistic UserRow-shaped object for use in mock query results. */
async function makeUserRow(overrides: Partial<{
  id: string;
  company_id: string;
  role_id: string;
  role_code: string;
  role_permissions: string[];
  email: string;
  display_name: string;
  password_hash: string;
  station_ids: string[];
  is_active: boolean;
}> = {}) {
  const password = overrides.password_hash ?? 'correct-password';
  const hash = password.startsWith('$2') ? password : await bcrypt.hash(password, 10);
  return {
    id: 'user-uuid-001',
    company_id: 'company-uuid-001',
    role_id: 'role-uuid-001',
    role_code: 'station_admin',
    role_permissions: ['playlist:read', 'playlist:write'],
    email: 'test@example.com',
    display_name: 'Test User',
    password_hash: hash,
    station_ids: ['station-1'],
    is_active: true,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('login', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Success path ────────────────────────────────────────────────────────────

  it('returns tokens and safe user on valid credentials', async () => {
    const plainPassword = 'correct-password';
    const userRow = await makeUserRow({ password_hash: await bcrypt.hash(plainPassword, 10) });

    // First call: SELECT user row
    mockQuery
      .mockResolvedValueOnce({ rows: [userRow] })
      // Second call: UPDATE last_login_at
      .mockResolvedValueOnce({ rows: [] })
      // Third call: INSERT refresh_tokens
      .mockResolvedValueOnce({ rows: [] });

    const result = await login('test@example.com', plainPassword);

    expect(result).toHaveProperty('tokens');
    expect(result.tokens).toHaveProperty('access_token');
    expect(result.tokens).toHaveProperty('refresh_token');
    expect(typeof result.tokens.access_token).toBe('string');
    expect(typeof result.tokens.refresh_token).toBe('string');
  });

  it('returns user object without password_hash and role_id', async () => {
    const plainPassword = 'correct-password';
    const userRow = await makeUserRow({ password_hash: await bcrypt.hash(plainPassword, 10) });

    mockQuery
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { user } = await login('test@example.com', plainPassword);

    expect(user).not.toHaveProperty('password_hash');
    expect(user).not.toHaveProperty('role_id');
    expect(user.id).toBe(userRow.id);
    expect(user.email).toBe(userRow.email);
    expect(user.display_name).toBe(userRow.display_name);
    expect(user.company_id).toBe(userRow.company_id);
    expect(user.role_code).toBe(userRow.role_code);
  });

  it('lower-cases the email before querying', async () => {
    const plainPassword = 'correct-password';
    const userRow = await makeUserRow({ password_hash: await bcrypt.hash(plainPassword, 10) });

    mockQuery
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await login('TEST@EXAMPLE.COM', plainPassword);

    // The first query should have been called with the lower-cased email.
    const firstCallArgs = mockQuery.mock.calls[0];
    expect(firstCallArgs[1]).toContain('test@example.com');
  });

  // ── User-not-found path ─────────────────────────────────────────────────────

  it('throws AuthError with INVALID_CREDENTIALS when no user row is returned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(login('unknown@example.com', 'any-password')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('throws AuthError with INVALID_CREDENTIALS when user is_active=false', async () => {
    const userRow = await makeUserRow({ is_active: false });
    mockQuery.mockResolvedValueOnce({ rows: [userRow] });

    await expect(login(userRow.email, 'correct-password')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  // ── Wrong password path ─────────────────────────────────────────────────────

  it('throws AuthError with INVALID_CREDENTIALS when password does not match', async () => {
    const userRow = await makeUserRow({ password_hash: await bcrypt.hash('real-password', 10) });
    mockQuery.mockResolvedValueOnce({ rows: [userRow] });

    await expect(login('test@example.com', 'wrong-password')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('throws an AuthError instance (not a plain Error) on bad password', async () => {
    const userRow = await makeUserRow({ password_hash: await bcrypt.hash('real-password', 10) });
    mockQuery.mockResolvedValueOnce({ rows: [userRow] });

    await expect(login('test@example.com', 'wrong-password')).rejects.toBeInstanceOf(AuthError);
  });

  // ── DB interaction ──────────────────────────────────────────────────────────

  it('calls pool.query at least twice on successful login (SELECT + UPDATE + INSERT)', async () => {
    const plainPassword = 'correct-password';
    const userRow = await makeUserRow({ password_hash: await bcrypt.hash(plainPassword, 10) });

    mockQuery
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await login('test@example.com', plainPassword);

    expect(mockQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── issueTokenPair ───────────────────────────────────────────────────────────

describe('issueTokenPair — thin JWT shape', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  /**
   * Helper: build a sync UserRow (no bcrypt needed) for issueTokenPair tests.
   * perm_version defaults to 1, is_active to true.
   */
  function makeUserRowSync(overrides: Partial<{
    id: string;
    company_id: string;
    role_id: string;
    role_code: string;
    role_permissions: string[];
    email: string;
    display_name: string;
    password_hash: string;
    station_ids: string[];
    perm_version: number;
    is_active: boolean;
  }> = {}) {
    return {
      id: 'user-uuid-100',
      company_id: 'company-uuid-100',
      role_id: 'role-uuid-100',
      role_code: 'station_admin',
      role_permissions: ['playlist:read'],
      email: 'staff@example.com',
      display_name: 'Staff User',
      password_hash: '$2b$12$placeholder',
      station_ids: ['station-1'],
      perm_version: 1,
      is_active: true,
      ...overrides,
    };
  }

  it('access token contains sub, cid, rc, tier, pv fields', async () => {
    const user = makeUserRowSync({ role_code: 'station_admin', perm_version: 1 });

    // Tier query → starter
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'starter' }] })
      // INSERT refresh_tokens
      .mockResolvedValueOnce({ rows: [] });

    const { access_token } = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);
    const decoded = jwt.decode(access_token) as Record<string, unknown>;

    expect(decoded).toHaveProperty('sub', user.id);
    expect(decoded).toHaveProperty('cid', user.company_id);
    expect(decoded).toHaveProperty('rc', 'station_admin');
    expect(decoded).toHaveProperty('tier', 'starter');
    expect(decoded).toHaveProperty('pv', 1);
  });

  it('access token does NOT contain permissions or station_ids fields', async () => {
    const user = makeUserRowSync({ role_code: 'station_admin' });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'starter' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { access_token } = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);
    const decoded = jwt.decode(access_token) as Record<string, unknown>;

    expect(decoded).not.toHaveProperty('permissions');
    expect(decoded).not.toHaveProperty('station_ids');
    expect(decoded).not.toHaveProperty('role_permissions');
  });

  it('station_admin: sys field is NOT present in token', async () => {
    const user = makeUserRowSync({ role_code: 'station_admin' });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'starter' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { access_token } = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);
    const decoded = jwt.decode(access_token) as Record<string, unknown>;

    expect(decoded).not.toHaveProperty('sys');
  });

  it('company_admin: sys=true is present in token', async () => {
    const user = makeUserRowSync({ role_code: 'company_admin' });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'professional' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { access_token } = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);
    const decoded = jwt.decode(access_token) as Record<string, unknown>;

    expect(decoded).toHaveProperty('sys', true);
  });

  it('super_admin: sys=true is present in token', async () => {
    const user = makeUserRowSync({ role_code: 'super_admin' });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'enterprise' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { access_token } = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);
    const decoded = jwt.decode(access_token) as Record<string, unknown>;

    expect(decoded).toHaveProperty('sys', true);
  });

  it('scheduler role: sys field is NOT present in token', async () => {
    const user = makeUserRowSync({ role_code: 'scheduler' });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'starter' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { access_token } = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);
    const decoded = jwt.decode(access_token) as Record<string, unknown>;

    expect(decoded).not.toHaveProperty('sys');
  });

  it('tier comes from subscriptions table query — reflects DB value in token', async () => {
    const user = makeUserRowSync({ role_code: 'station_admin' });

    // DB returns 'enterprise'
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'enterprise' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { access_token } = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);
    const decoded = jwt.decode(access_token) as Record<string, unknown>;

    expect(decoded).toHaveProperty('tier', 'enterprise');
  });

  it('falls back to "free" tier when no active subscription found', async () => {
    const user = makeUserRowSync({ role_code: 'station_admin' });

    // Tier query returns empty rows
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { access_token } = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);
    const decoded = jwt.decode(access_token) as Record<string, unknown>;

    expect(decoded).toHaveProperty('tier', 'free');
  });

  it('perm_version in token matches user.perm_version', async () => {
    const user = makeUserRowSync({ role_code: 'station_admin', perm_version: 7 });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'starter' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { access_token } = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);
    const decoded = jwt.decode(access_token) as Record<string, unknown>;

    expect(decoded).toHaveProperty('pv', 7);
  });

  it('returns both access_token and refresh_token', async () => {
    const user = makeUserRowSync();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tier: 'starter' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await issueTokenPair(user as Parameters<typeof issueTokenPair>[0]);

    expect(result).toHaveProperty('access_token');
    expect(result).toHaveProperty('refresh_token');
    expect(typeof result.access_token).toBe('string');
    expect(typeof result.refresh_token).toBe('string');
  });
});
