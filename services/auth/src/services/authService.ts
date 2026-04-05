import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getPool } from '../db';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwtService';
import { TokenPair } from '@playgen/types';
import type { RoleCode, JwtPayload, SubscriptionTier } from '@playgen/types';
import { sendPasswordResetEmail, sendVerificationEmail } from './emailService';

export interface UserRow {
  id: string;
  company_id: string;
  role_id: string;
  role_code: RoleCode;
  role_permissions: string[];
  email: string;
  display_name: string;
  password_hash: string;
  station_ids: string[];
  perm_version: number;
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
            u.password_hash, u.station_ids, COALESCE(u.perm_version, 1) AS perm_version, u.is_active
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
  const { password_hash: _password_hash, role_id: _role_id, ...safeUser } = user;
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
            u.password_hash, u.station_ids, COALESCE(u.perm_version, 1) AS perm_version, u.is_active
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

export async function issueTokenPair(user: UserRow): Promise<TokenPair> {
  const pool = getPool();

  // Get subscription tier — falls back to 'free' if no active subscription found
  const tierResult = await pool.query<{ tier: string }>(
    `SELECT COALESCE(s.tier, 'free') AS tier
     FROM users u
     LEFT JOIN subscriptions s ON s.company_id = u.company_id
       AND s.status IN ('active', 'trialing', 'past_due')
     WHERE u.id = $1
     LIMIT 1`,
    [user.id],
  );
  const tier = (tierResult.rows[0]?.tier ?? 'free') as SubscriptionTier;
  const isSystemRole = ['super_admin', 'company_admin'].includes(user.role_code);

  const accessPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    cid: user.company_id,
    rc: user.role_code,
    tier,
    pv: user.perm_version ?? 1,
    ...(isSystemRole ? { sys: true as const } : {}),
  };

  const accessToken = signAccessToken(accessPayload);

  const refreshToken = signRefreshToken(user.id);
  const tokenHash = hashToken(refreshToken);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [user.id, tokenHash],
  );

  return { access_token: accessToken, refresh_token: refreshToken };
}

// ─── Password Reset ───────────────────────────────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE email = $1 AND is_active = TRUE`,
    [email.toLowerCase()]
  );
  if (rows.length === 0) return;
  const user = rows[0];
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [user.id, tokenHash]);
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;
  await sendPasswordResetEmail(user.email, resetLink);
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const pool = getPool();
  const tokenHash = hashToken(rawToken);
  const { rows } = await pool.query<{ id: string; user_id: string }>(`SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`, [tokenHash]);
  if (rows.length === 0) throw new AuthError('INVALID_TOKEN', 'Reset token is invalid or has expired');
  const { id: tokenId, user_id } = rows[0];
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, user_id]);
  await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [tokenId]);
  await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [user_id]);
}

export async function acceptInvite(rawToken: string, displayName: string, password: string): Promise<{ tokens: TokenPair; user: Omit<UserRow, 'password_hash' | 'role_id'> }> {
  const pool = getPool();
  const tokenHash = hashToken(rawToken);
  const { rows } = await pool.query<{ id: string; company_id: string; role_id: string; email: string; station_ids: string[] }>(`SELECT id, company_id, role_id, email, station_ids FROM user_invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > NOW()`, [tokenHash]);
  if (rows.length === 0) throw new AuthError('INVALID_TOKEN', 'Invite token is invalid or has expired');
  const invite = rows[0];
  const { rows: existing } = await pool.query(`SELECT id FROM users WHERE email = $1`, [invite.email]);
  if (existing.length > 0) throw new AuthError('EMAIL_TAKEN', 'An account with this email already exists');
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows: newUserRows } = await pool.query<{ id: string }>(`INSERT INTO users (company_id, role_id, email, display_name, password_hash, station_ids) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [invite.company_id, invite.role_id, invite.email, displayName, passwordHash, invite.station_ids]);
  const newUserId = newUserRows[0].id;
  await pool.query(`UPDATE user_invites SET accepted_at = NOW() WHERE id = $1`, [invite.id]);
  // Auto-verify email since user proved ownership via invite email
  await pool.query('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [newUserId]);
  const { rows: userRows } = await pool.query<UserRow>(`SELECT u.id, u.company_id, u.role_id, r.code AS role_code, r.permissions AS role_permissions, u.email, u.display_name, u.password_hash, u.station_ids, COALESCE(u.perm_version, 1) AS perm_version, u.is_active FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [newUserId]);
  const tokens = await issueTokenPair(userRows[0]);
  const { password_hash: _password_hash, role_id: _role_id, ...safeUser } = userRows[0];
  return { tokens, user: safeUser };
}

export async function adminResetPassword(adminCompanyId: string, adminRoleCode: RoleCode, targetUserId: string, newPassword: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; company_id: string }>(`SELECT id, company_id FROM users WHERE id = $1`, [targetUserId]);
  if (rows.length === 0) throw new AuthError('USER_NOT_FOUND', 'User not found');
  const targetUser = rows[0];
  if (adminRoleCode !== 'super_admin' && targetUser.company_id !== adminCompanyId) throw new AuthError('FORBIDDEN', 'You can only reset passwords for users in your company');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, targetUserId]);
  await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [targetUserId]);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Email Verification ───────────────────────────────────────────────────────

export async function sendEmailVerification(userId: string, email: string): Promise<void> {
  const pool = getPool();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  // Invalidate existing unused tokens for this user
  await pool.query(
    `UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
    [userId, tokenHash]
  );
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const verifyLink = `${frontendUrl}/verify-email?token=${rawToken}`;
  await sendVerificationEmail(email, verifyLink);
}

export async function verifyEmail(rawToken: string): Promise<void> {
  const pool = getPool();
  const tokenHash = hashToken(rawToken);
  const { rows } = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );
  if (rows.length === 0) throw new AuthError('INVALID_TOKEN', 'Verification token is invalid or has expired');
  const { id: tokenId, user_id } = rows[0];
  await pool.query('UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1', [user_id]);
  await pool.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [tokenId]);
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
