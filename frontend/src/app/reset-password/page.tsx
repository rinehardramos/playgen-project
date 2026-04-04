'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

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
      setError('Invalid or missing reset token. Please request a new reset link.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/v1/auth/reset-password', { token, password });
      setSuccess(true);
      setTimeout(() => router.push('/login'), 3000);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#16161f] border border-[#2a2a40] rounded-2xl p-8 shadow-2xl">
      {success ? (
        <div className="text-center">
          <div className="w-12 h-12 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Password reset!</h2>
          <p className="text-gray-400 text-sm mb-4">
            Your password has been updated. Redirecting you to sign in…
          </p>
          <Link href="/login" className="text-violet-400 hover:text-violet-300 text-sm font-medium">
            Sign in now
          </Link>
        </div>
      ) : (
        <>
          <h2 className="text-lg font-semibold text-white mb-2">Set new password</h2>
          <p className="text-gray-400 text-sm mb-6">
            Choose a strong password with at least 8 characters.
          </p>

          {!token && (
            <div className="bg-yellow-900/30 border border-yellow-700/50 text-yellow-400 text-sm px-4 py-3 rounded-lg mb-5">
              No reset token found. Please use the link from your email.
            </div>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm px-4 py-3 rounded-lg mb-5">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">New password</label>
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
                  Resetting…
                </span>
              ) : 'Reset password'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/login" className="text-gray-500 hover:text-gray-400 text-sm">
              Back to sign in
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
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
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
