'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  role_label: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const data = await api.get<UserProfile>('/api/v1/me');
        setProfile(data);
        setDisplayName(data.display_name);
      } catch (err) {
        console.error('Failed to load profile:', err);
        setError('Failed to load profile information.');
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSaving(true);
    try {
      const updateData: any = { display_name: displayName };
      if (password) {
        updateData.password = password;
      }

      await api.put('/api/v1/me', updateData);
      
      setSuccess('Profile updated successfully.');
      setPassword('');
      setConfirmPassword('');
      
      // Update local profile state
      if (profile) {
        setProfile({ ...profile, display_name: displayName });
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">My Profile</h1>
        <p className="text-gray-400">Manage your account settings and password</p>
      </div>

      <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl shadow-xl overflow-hidden">
        <div className="p-6 border-b border-[#2a2a40] bg-[#13131a]/50">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-violet-600/30 flex items-center justify-center text-violet-300 text-2xl font-bold border border-violet-500/20">
              {(profile?.display_name?.[0] ?? profile?.email?.[0] ?? '?').toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">{profile?.display_name}</h2>
              <p className="text-gray-400 text-sm">{profile?.email}</p>
              <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-violet-500/10 text-violet-400 border border-violet-500/20">
                {profile?.role_label}
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
          
          {success && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm">
              {success}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-[#0f0f1a] border border-[#2a2a40] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-colors"
                placeholder="Your name"
              />
            </div>

            <div className="pt-4 border-t border-[#2a2a40]">
              <h3 className="text-sm font-semibold text-white mb-4">Change Password</h3>
              <p className="text-xs text-gray-500 mb-4 italic">Leave blank if you don't want to change it</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#0f0f1a] border border-[#2a2a40] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-colors"
                    placeholder="Minimum 8 characters"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-[#0f0f1a] border border-[#2a2a40] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-colors"
                    placeholder="Repeat new password"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-6 rounded-lg transition-all shadow-lg shadow-violet-900/20 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
