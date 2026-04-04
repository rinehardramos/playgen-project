import crypto from 'crypto';
import { getPool } from '../db';

interface CreateInviteParams {
  companyId: string;
  invitedBy: string;
  email: string;
  roleId: string;
  stationIds: string[];
}

interface InviteResult {
  id: string;
  email: string;
  invite_link: string;
  expires_at: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createInvite(params: CreateInviteParams): Promise<InviteResult> {
  const { companyId, invitedBy, email, roleId, stationIds } = params;
  const pool = getPool();

  // Verify role exists
  const { rows: roleRows } = await pool.query(
    `SELECT id FROM roles WHERE id = $1`,
    [roleId]
  );
  if (roleRows.length === 0) {
    throw Object.assign(new Error('Role not found'), { statusCode: 400, code: 'INVALID_ROLE' });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);

  const { rows } = await pool.query<{ id: string; expires_at: Date }>(
    `INSERT INTO user_invites (company_id, role_id, email, station_ids, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '7 days')
     RETURNING id, expires_at`,
    [companyId, roleId, email.toLowerCase(), stationIds, tokenHash, invitedBy]
  );

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const inviteLink = `${appUrl}/accept-invite?token=${rawToken}`;

  // MVP stub: log the invite link
  console.log(`[EMAIL STUB] Invite for ${email}: ${inviteLink}`);

  return {
    id: rows[0].id,
    email: email.toLowerCase(),
    invite_link: inviteLink,
    expires_at: rows[0].expires_at.toISOString(),
  };
}
