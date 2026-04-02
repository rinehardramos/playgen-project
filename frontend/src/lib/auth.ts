import { api, setToken, clearToken, getToken } from './api';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role_code: string;
  company_id: string;
  station_ids: string[];
}

export interface LoginResponse {
  tokens: { access_token: string; refresh_token: string };
  user: AuthUser;
}

const USER_KEY = 'playgen_user';

function saveUser(user: AuthUser): void {
  try { sessionStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* SSR or private */ }
}

function loadUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch { return null; }
}

function removeUser(): void {
  try { sessionStorage.removeItem(USER_KEY); } catch { /* ignore */ }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await api.post<LoginResponse>('/api/v1/auth/login', { email, password });
  setToken(data.tokens.access_token);
  saveUser(data.user);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await api.post<void>('/api/v1/auth/logout', {});
  } finally {
    clearToken();
    removeUser();
  }
}

export function getCurrentUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;

  // Check token expiry
  try {
    const parts = token.split('.');
    if (parts.length !== 3) { clearToken(); removeUser(); return null; }
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as Record<string, unknown>;
    if (typeof json['exp'] === 'number' && json['exp'] * 1000 < Date.now()) {
      clearToken(); removeUser(); return null;
    }
  } catch { clearToken(); removeUser(); return null; }

  return loadUser();
}
