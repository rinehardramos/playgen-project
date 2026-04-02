'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

interface DashboardStats {
  active_songs: number;
  todays_playlists: number;
  pending_approvals: number;
  active_stations: number;
}

interface StatCard {
  label: string;
  value: number | string;
  href: string;
  color: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const user = getCurrentUser();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      router.replace('/login');
      return;
    }

    api
      .get<DashboardStats>('/api/v1/dashboard/stats')
      .then((data) => setStats(data))
      .catch((err: ApiError) => {
        // If endpoint doesn't exist yet, fall back to placeholder zeros
        if (err.status === 404) {
          setStats({ active_songs: 0, todays_playlists: 0, pending_approvals: 0, active_stations: 0 });
        } else {
          setError(err.message ?? 'Failed to load stats');
        }
      })
      .finally(() => setLoading(false));
  }, [router, user]);

  if (!user) return null;

  const cards: StatCard[] = [
    {
      label: 'Active Songs',
      value: stats?.active_songs ?? '—',
      href: '/library',
      color: 'bg-[#1c1c28]',
    },
    {
      label: "Today's Playlists",
      value: stats?.todays_playlists ?? '—',
      href: '/playlists',
      color: 'bg-[#1c1c28]',
    },
    {
      label: 'Pending Approvals',
      value: stats?.pending_approvals ?? '—',
      href: '/playlists',
      color: 'bg-[#1c1c28]',
    },
    {
      label: 'Active Stations',
      value: stats?.active_stations ?? '—',
      href: '/analytics',
      color: 'bg-[#1c1c28]',
    },
  ];

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-white">
          Welcome, {user.display_name || user.email}
        </h1>
        <p className="text-sm text-gray-400 mt-1">Here&apos;s an overview of your station activity.</p>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="card p-6 hover:bg-[#24243a] transition-colors"
          >
            <p className="text-sm font-medium text-gray-500">{card.label}</p>
            {loading ? (
              <div className="mt-2 h-8 w-16 bg-[#2a2a40] animate-pulse rounded" />
            ) : (
              <p className="text-3xl font-bold text-white mt-2">{card.value}</p>
            )}
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="mt-10">
        <h2 className="text-base font-semibold text-white mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/playlists" className="btn-primary inline-flex items-center">
            View Playlists
          </Link>
          <Link href="/templates" className="btn-secondary inline-flex items-center">
            Manage Templates
          </Link>
          <Link href="/library" className="btn-secondary inline-flex items-center">
            Song Library
          </Link>
        </div>
      </div>
    </div>
  );
}
