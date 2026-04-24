import jwt from 'jsonwebtoken';
import { JwtPayload } from '@playgen/types';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-in-prod';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-in-prod';
// TOKEN_TTL_MINUTES: user-facing knob (default 15 min). Set to 60 for dev/admin
// environments where long-running operations (HLS generation, audio sourcing)
// would otherwise cause mid-workflow token expiry.
// JWT_ACCESS_EXPIRES_SEC overrides TOKEN_TTL_MINUTES for finer-grained control.
const _ttlMinutes = parseInt(process.env.TOKEN_TTL_MINUTES ?? '15', 10);
// Use numeric seconds — avoids the ms `StringValue` branded-type incompatibility in @types/jsonwebtoken@9
const ACCESS_EXPIRES_SEC = Number(process.env.JWT_ACCESS_EXPIRES_SEC ?? _ttlMinutes * 60);
const REFRESH_EXPIRES_SEC = Number(process.env.JWT_REFRESH_EXPIRES_SEC ?? 604800); // default 7 days

export function signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload as object, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_SEC });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_SEC });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, REFRESH_SECRET) as { sub: string };
}
