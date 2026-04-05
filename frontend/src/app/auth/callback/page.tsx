'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setToken } from '@/lib/api';
import { api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';

const USER_KEY = 'playgen_user';

function saveUser(user: AuthUser): void {
  try { sessionStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* SSR */ }
}

interface MeResponse {
  id: string;
  email: string;
  display_name: string;
}

interface JwtPayload {
  sub: string;
  company_id: string;
  station_ids: string[];
  role_code: string;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

export default function OAuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const accessToken = params.get('access_token');
    const errorParam = params.get('error');

    if (errorParam === 'no_account') {
      router.replace('/login?error=no_account');
      return;
    }
    if (errorParam || !accessToken) {
      setError('Sign-in failed. Please try again.');
      return;
    }

    const payload = decodeJwtPayload(accessToken);
    if (!payload) {
      setError('Invalid token received. Please try again.');
      return;
    }

    setToken(accessToken);

    api.get<MeResponse>('/api/v1/me')
      .then((me) => {
        const user: AuthUser = {
          id: me.id,
          email: me.email,
          display_name: me.display_name,
          role_code: payload.role_code,
          company_id: payload.company_id,
          station_ids: payload.station_ids,
        };
        saveUser(user);
        router.replace('/dashboard');
      })
      .catch(() => {
        setError('Failed to load your profile. Please try again.');
      });
  }, [params, router]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#0b0b10] flex items-center justify-center p-4">
        <div className="bg-[#16161f] border border-[#2a2a40] rounded-2xl p-8 shadow-2xl max-w-sm w-full">
          <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm px-4 py-3 rounded-lg mb-5">
            {error}
          </div>
          <a
            href="/login"
            className="btn-primary w-full py-2.5 block text-center"
          >
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0b10] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <svg className="animate-spin w-8 h-8 text-violet-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <p className="text-gray-400 text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
