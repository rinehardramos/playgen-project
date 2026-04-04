'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/v1/auth/forgot-password', { email });
      setSubmitted(true);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

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

        <div className="bg-[#16161f] border border-[#2a2a40] rounded-2xl p-8 shadow-2xl">
          {submitted ? (
            <div className="text-center">
              <div className="w-12 h-12 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white mb-2">Check your email</h2>
              <p className="text-gray-400 text-sm mb-6">
                If an account with that email exists, we've sent a password reset link. Check your inbox (and spam folder).
              </p>
              <Link href="/login" className="text-violet-400 hover:text-violet-300 text-sm font-medium">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-white mb-2">Forgot your password?</h2>
              <p className="text-gray-400 text-sm mb-6">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              {error && (
                <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm px-4 py-3 rounded-lg mb-5">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="input"
                    placeholder="you@station.com"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-2.5 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Sending…
                    </span>
                  ) : 'Send reset link'}
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
      </div>
    </div>
  );
}
