'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const verified = searchParams.get('verified');
  const error = searchParams.get('error');

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState('');

  async function handleResend() {
    setResending(true);
    setResendError('');
    try {
      const token = sessionStorage.getItem('playgen_access_token');
      const res = await fetch('/api/v1/auth/send-verification', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json() as { error?: { message: string } };
        throw new Error(data.error?.message ?? 'Failed to resend.');
      }
      setResent(true);
    } catch (err: unknown) {
      setResendError(err instanceof Error ? err.message : 'Failed to resend.');
    } finally {
      setResending(false);
    }
  }

  if (verified === 'true') {
    return (
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-green-900/30 rounded-full mb-4">
          <svg className="w-7 h-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Email verified!</h2>
        <p className="text-gray-400 text-sm mb-6">Your email address has been confirmed.</p>
        <Link href="/login" className="btn-primary inline-block px-6 py-2.5">
          Sign in
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-red-900/30 rounded-full mb-4">
          <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Verification failed</h2>
        <p className="text-gray-400 text-sm mb-6">This link is invalid or has expired.</p>
        {resent ? (
          <p className="text-green-400 text-sm">New verification email sent! Check your inbox.</p>
        ) : (
          <>
            {resendError && <p className="text-red-400 text-sm mb-3">{resendError}</p>}
            <button onClick={handleResend} disabled={resending} className="btn-primary px-6 py-2.5 disabled:opacity-50">
              {resending ? 'Sending\u2026' : 'Resend verification email'}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 bg-violet-900/30 rounded-full mb-4">
        <svg className="w-7 h-7 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">Check your email</h2>
      <p className="text-gray-400 text-sm mb-6">We&apos;ve sent a verification link to your email address. It expires in 24 hours.</p>
      {resent ? (
        <p className="text-green-400 text-sm">New verification email sent!</p>
      ) : (
        <>
          {resendError && <p className="text-red-400 text-sm mb-3">{resendError}</p>}
          <button onClick={handleResend} disabled={resending} className="text-violet-400 hover:text-violet-300 text-sm transition-colors disabled:opacity-50">
            {resending ? 'Sending\u2026' : 'Resend verification email'}
          </button>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
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
          <Suspense fallback={<p className="text-gray-400 text-center">Loading\u2026</p>}>
            <VerifyEmailContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
