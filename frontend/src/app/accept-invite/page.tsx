'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, setToken } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface AcceptInviteResponse {
  tokens: { access_token: string; refresh_token: string };
  user: {
    id: string;
    email: string;
    display_name: string;
    role_code: string;
    company_id: string;
    station_ids: string[];
  };
}

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!token) {
      setError('Invalid or missing invite token. Please use the link from your invitation email.');
      return;
    }

    setLoading(true);
    try {
      const data = await api.post<AcceptInviteResponse>('/api/v1/auth/accept-invite', {
        token,
        display_name: displayName,
        password,
      });
      setToken(data.tokens.access_token);
      try {
        sessionStorage.setItem('playgen_user', JSON.stringify(data.user));
      } catch {
        // ignore
      }
      router.push('/dashboard');
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to accept invite. The link may have expired.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#16161f] border border-[#2a2a40] rounded-2xl p-8 shadow-2xl">
      <h2 className="text-lg font-semibold text-white mb-2">Accept your invitation</h2>
      <p className="text-gray-400 text-sm mb-6">
        Set up your display name and create a password to join your team.
      </p>

      {!token && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 text-yellow-400 text-sm px-4 py-3 rounded-lg mb-5">
          No invite token found. Please use the link from your invitation email.
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm px-4 py-3 rounded-lg mb-5">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            className="input"
            placeholder="Your full name"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="input"
            placeholder="••••••••"
            minLength={8}
            required
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Confirm password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="input"
            placeholder="••••••••"
            minLength={8}
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading || !token}
          className="btn-primary w-full py-2.5 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Creating account…
            </span>
          ) : 'Create account'}
        </button>
      </form>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen bg-[#0b0b10] flex items-center justify-center p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-900/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-900/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-violet-600 rounded-2xl mb-4 shadow-lg shadow-violet-900/50">
            <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">PlayGen</h1>
          <p className="text-gray-500 text-sm mt-1">Radio Playlist Manager</p>
        </div>

        <Suspense fallback={<div className="bg-[#16161f] border border-[#2a2a40] rounded-2xl p-8 shadow-2xl text-center text-gray-400">Loading…</div>}>
          <AcceptInviteForm />
        </Suspense>
      </div>
    </div>
  );
}
