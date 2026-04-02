import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getPool } from '../db';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwtService';
import { ROLE_PERMISSIONS, TokenPair } from '@playgen/types';
import type { RoleCode, Permission } from '@playgen/types';

interface UserRow {
  id: string;
  company_id: string;
  role_id: string;
  role_code: RoleCode;
  role_permissions: Permission[];
  email: string;
  display_name: string;
  password_hash: string;
  station_ids: string[];
  is_active: boolean;
}

export async function login(email: string, password: string): Promise<{
  tokens: TokenPair;
  user: Omit<UserRow, 'password_hash' | 'role_id'>;
}> {
  const pool = getPool();
  const { rows } = await pool.query<UserRow>(
    `SELECT u.id, u.company_id, u.role_id, r.code AS role_code,
            r.permissions AS role_permissions, u.email, u.display_name,
            u.password_hash, u.station_ids, u.is_active
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1`,
    [email.toLowerCase()]
  );

  const user = rows[0];
  if (!user || !user.is_active) throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  const tokens = await issueTokenPair(user);
  const { password_hash, role_id, ...safeUser } = user;
  return { tokens, user: safeUser };
}

export async function refresh(rawRefreshToken: string): Promise<TokenPair> {
  const pool = getPool();
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new AuthError('INVALID_TOKEN', 'Refresh token is invalid or expired');
  }

  const tokenHash = hashToken(rawRefreshToken);
  const { rows } = await pool.query(
    `SELECT id FROM refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );
  if (rows.length === 0) throw new AuthError('INVALID_TOKEN', 'Refresh token not found or revoked');

  // Rotate: revoke old token
  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1', [tokenHash]);

  const { rows: userRows } = await pool.query<UserRow>(
    `SELECT u.id, u.company_id, u.role_id, r.code AS role_code,
            r.permissions AS role_permissions, u.email, u.display_name,
            u.password_hash, u.station_ids, u.is_active
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.is_active = TRUE`,
    [payload.sub]
  );
  if (userRows.length === 0) throw new AuthError('INVALID_TOKEN', 'User not found');

  return issueTokenPair(userRows[0]);
}

export async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await getPool().query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
    [tokenHash]
  );
}

async function issueTokenPair(user: UserRow): Promise<TokenPair> {
  const pool = getPool();
  const permissions = user.role_permissions?.length
    ? user.role_permissions
    : (ROLE_PERMISSIONS[user.role_code] ?? []);

  const accessToken = signAccessToken({
    sub: user.id,
    company_id: user.company_id,
    station_ids: user.station_ids,
    role_code: user.role_code,
    permissions,
  });

  const refreshToken = signRefreshToken(user.id);
  const tokenHash = hashToken(refreshToken);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [user.id, tokenHash]
  );

  return { access_token: accessToken, refresh_token: refreshToken };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
