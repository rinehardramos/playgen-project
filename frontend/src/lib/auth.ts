import { api, setToken, clearToken, getToken } from './api';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  company_id: string;
  station_ids: string[];
}

export interface LoginResponse {
  access_token: string;
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await api.post<LoginResponse>('/api/v1/auth/login', { email, password });
  setToken(data.access_token);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await api.post<void>('/api/v1/auth/logout', {});
  } finally {
    clearToken();
  }
}

export function getCurrentUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;

  try {
    // JWT is three base64url-encoded parts separated by dots
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode the payload (second part)
    const payload = parts[1];
    // base64url → base64: replace - with + and _ with /
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    // Pad to a multiple of 4
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(padded);
    const json = JSON.parse(decoded) as Record<string, unknown>;

    // Check expiry
    if (typeof json['exp'] === 'number' && json['exp'] * 1000 < Date.now()) {
      clearToken();
      return null;
    }

    return {
      id: String(json['sub'] ?? json['id'] ?? ''),
      email: String(json['email'] ?? ''),
      display_name: String(json['display_name'] ?? json['name'] ?? ''),
      role: String(json['role'] ?? ''),
      company_id: String(json['company_id'] ?? ''),
      station_ids: Array.isArray(json['station_ids'])
        ? (json['station_ids'] as unknown[]).map(String)
        : [],
    };
  } catch {
    return null;
  }
}
