import { getPool } from '../db';
import { TokenPair } from '@playgen/types';
import { AuthError, UserRow, issueTokenPair } from './authService';

export interface GoogleProfile {
  id: string;   // Google "sub" claim
  email: string;
  name: string;
}

export async function loginWithGoogle(profile: GoogleProfile): Promise<{
  tokens: TokenPair;
  user: Omit<UserRow, 'password_hash' | 'role_id'>;
}> {
  const pool = getPool();

  // 1. Returning user — matched by oauth_id
  const { rows: byId } = await pool.query<UserRow>(
    `SELECT u.id, u.company_id, u.role_id, r.code AS role_code,
            r.permissions AS role_permissions, u.email, u.display_name,
            u.password_hash, u.station_ids, u.is_active
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.oauth_provider = 'google' AND u.oauth_id = $1 AND u.is_active = TRUE`,
    [profile.id],
  );

  if (byId.length > 0) {
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [byId[0].id]);
    const tokens = await issueTokenPair(byId[0]);
    const { password_hash: _, role_id: __, ...safeUser } = byId[0];
    return { tokens, user: safeUser };
  }

  // 2. Account linking — matched by email (first Google login for existing account)
  const { rows: byEmail } = await pool.query<UserRow>(
    `SELECT u.id, u.company_id, u.role_id, r.code AS role_code,
            r.permissions AS role_permissions, u.email, u.display_name,
            u.password_hash, u.station_ids, u.is_active
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1 AND u.is_active = TRUE`,
    [profile.email.toLowerCase()],
  );

  if (byEmail.length > 0) {
    const user = byEmail[0];
    // Store oauth_id so future logins go through the faster path above
    await pool.query(
      `UPDATE users SET oauth_provider = 'google', oauth_id = $1, last_login_at = NOW() WHERE id = $2`,
      [profile.id, user.id],
    );
    const tokens = await issueTokenPair(user);
    const { password_hash: _, role_id: __, ...safeUser } = user;
    return { tokens, user: safeUser };
  }

  // 3. No matching account
  throw new AuthError(
    'OAUTH_NO_ACCOUNT',
    'No PlayGen account found for this Google email. Contact your administrator.',
  );
}
