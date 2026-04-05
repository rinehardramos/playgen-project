'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise';
type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';

interface TierLimits {
  tier: SubscriptionTier;
  max_stations: number;
  max_users: number;
  max_songs: number;
  max_sub_stations: number;
  feature_dj: boolean;
  feature_analytics: boolean;
  feature_s3: boolean;
  feature_api_keys: boolean;
  feature_custom_roles: boolean;
  feature_hierarchy: boolean;
}

interface SubscriptionUsage {
  stations: number;
  users: number;
  songs: number;
}

interface SubscriptionData {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  limits: TierLimits;
  usage: SubscriptionUsage;
}

const TIER_ORDER: SubscriptionTier[] = ['free', 'starter', 'professional', 'enterprise'];

const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: 'Free',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

const TIER_BADGE_CLASSES: Record<SubscriptionTier, string> = {
  free: 'bg-gray-700/60 text-gray-300 border border-gray-600/50',
  starter: 'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  professional: 'bg-violet-900/50 text-violet-300 border border-violet-700/50',
  enterprise: 'bg-yellow-900/50 text-yellow-300 border border-yellow-600/50',
};

const TIER_PRICES: Record<SubscriptionTier, string> = {
  free: '$0/mo',
  starter: '$29/mo',
  professional: '$99/mo',
  enterprise: 'Custom',
};

const TIER_STATIC_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    tier: 'free', max_stations: 1, max_users: 2, max_songs: 500,
    max_sub_stations: 0,
    feature_dj: false, feature_analytics: false, feature_s3: false,
    feature_api_keys: false, feature_custom_roles: false, feature_hierarchy: false,
  },
  starter: {
    tier: 'starter', max_stations: 3, max_users: 5, max_songs: 2000,
    max_sub_stations: 0,
    feature_dj: true, feature_analytics: false, feature_s3: false,
    feature_api_keys: false, feature_custom_roles: false, feature_hierarchy: false,
  },
  professional: {
    tier: 'professional', max_stations: 10, max_users: 20, max_songs: 10000,
    max_sub_stations: 5,
    feature_dj: true, feature_analytics: true, feature_s3: true,
    feature_api_keys: true, feature_custom_roles: true, feature_hierarchy: false,
  },
  enterprise: {
    tier: 'enterprise', max_stations: -1, max_users: -1, max_songs: -1,
    max_sub_stations: -1,
    feature_dj: true, feature_analytics: true, feature_s3: true,
    feature_api_keys: true, feature_custom_roles: true, feature_hierarchy: true,
  },
};

const FEATURES: { key: keyof TierLimits; label: string; icon: string }[] = [
  { key: 'feature_dj', label: 'AI DJ', icon: '🎙' },
  { key: 'feature_analytics', label: 'Analytics', icon: '📊' },
  { key: 'feature_s3', label: 'S3 Storage', icon: '☁' },
  { key: 'feature_api_keys', label: 'API Keys', icon: '🔑' },
  { key: 'feature_custom_roles', label: 'Custom Roles', icon: '🛡' },
  { key: 'feature_hierarchy', label: 'Station Hierarchy', icon: '🏗' },
];

function UsageBar({
  label,
  current,
  limit,
}: {
  label: string;
  current: number;
  limit: number;
}) {
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : Math.min((current / limit) * 100, 100);
  const isHigh = !unlimited && pct > 80;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-gray-300">{label}</span>
        <span className={`text-sm font-medium ${isHigh ? 'text-red-400' : 'text-gray-400'}`}>
          {current.toLocaleString()} / {unlimited ? '∞' : limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[#1e1e2e] overflow-hidden">
        {!unlimited && (
          <div
            className={`h-full rounded-full transition-all ${
              isHigh ? 'bg-red-500' : 'bg-violet-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        )}
        {unlimited && (
          <div className="h-full rounded-full bg-violet-500/30" style={{ width: '100%' }} />
        )}
      </div>
    </div>
  );
}

function CheckIcon({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function limitLabel(val: number): string {
  return val === -1 ? 'Unlimited' : val.toLocaleString();
}

export default function BillingPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const companyId = currentUser?.company_id ?? '';

  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    fetchSubscription();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchSubscription() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<SubscriptionData>(
        `/api/v1/companies/${companyId}/subscription`
      );
      setData(result);
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load subscription data');
    } finally {
      setLoading(false);
    }
  }

  const currentTier = data?.tier ?? 'free';
  const isEnterprise = currentTier === 'enterprise';

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Billing &amp; Subscription</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your plan, view usage, and upgrade your subscription
        </p>
      </div>

      {/* Cancel-at-period-end warning */}
      {data?.cancel_at_period_end && (
        <div className="mb-6 rounded-lg bg-yellow-900/20 border border-yellow-700/50 px-4 py-3 flex items-start gap-3">
          <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-yellow-300">Subscription cancellation scheduled</p>
            <p className="text-sm text-yellow-400/80 mt-0.5">
              Your plan will be cancelled at the end of the current period on{' '}
              <strong>{formatDate(data.current_period_end)}</strong>. After that, your account
              will revert to the Free plan.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-900/30 border border-red-700/50 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={fetchSubscription}
            className="mt-2 text-xs text-red-300 underline hover:text-red-200"
          >
            Try again
          </button>
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Current Plan Card */}
          <div className="card p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-white font-semibold text-lg">Current Plan</h2>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${
                      TIER_BADGE_CLASSES[currentTier]
                    }`}
                  >
                    {TIER_LABELS[currentTier]}
                  </span>
                  {data.status !== 'active' && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide bg-red-900/50 text-red-300 border border-red-700/50">
                      {data.status.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-400">
                  {TIER_PRICES[currentTier]} &nbsp;&bull;&nbsp;{' '}
                  {data.current_period_end
                    ? `Renews ${formatDate(data.current_period_end)}`
                    : 'No renewal date'}
                </p>
              </div>
              <a
                href="mailto:sales@playgen.site?subject=Upgrade%20Subscription"
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  isEnterprise
                    ? 'bg-[#1e1e2e] text-gray-500 cursor-not-allowed pointer-events-none'
                    : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                {isEnterprise ? 'Max Plan' : 'Upgrade Plan'}
              </a>
            </div>
          </div>

          {/* Usage Bars */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-5">
              Usage
            </h2>
            <div className="space-y-5">
              <UsageBar
                label="Stations"
                current={data.usage.stations}
                limit={data.limits.max_stations}
              />
              <UsageBar
                label="Users"
                current={data.usage.users}
                limit={data.limits.max_users}
              />
              <UsageBar
                label="Songs"
                current={data.usage.songs}
                limit={data.limits.max_songs}
              />
            </div>
          </div>

          {/* Feature Flags */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-5">
              Included Features
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {FEATURES.map(({ key, label, icon }) => {
                const enabled = !!data.limits[key as keyof TierLimits];
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg border ${
                      enabled
                        ? 'bg-green-900/10 border-green-800/30'
                        : 'bg-[#111118] border-[#2a2a40]'
                    }`}
                  >
                    <CheckIcon enabled={enabled} />
                    <span className={`text-sm ${enabled ? 'text-gray-200' : 'text-gray-600'}`}>
                      {icon} {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tier Comparison Table */}
          <div className="card p-6 overflow-x-auto">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-5">
              Plan Comparison
            </h2>
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-[#2a2a40]">
                  <th className="text-left pb-3 text-gray-500 font-medium w-40">Feature</th>
                  {TIER_ORDER.map((tier) => (
                    <th key={tier} className="pb-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            TIER_BADGE_CLASSES[tier]
                          } ${tier === currentTier ? 'ring-1 ring-violet-400' : ''}`}
                        >
                          {TIER_LABELS[tier]}
                        </span>
                        <span className="text-gray-500 text-xs font-normal">{TIER_PRICES[tier]}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e1e2e]">
                <tr>
                  <td className="py-3 text-gray-400">Stations</td>
                  {TIER_ORDER.map((tier) => (
                    <td key={tier} className="py-3 text-center text-gray-300">
                      {limitLabel(TIER_STATIC_LIMITS[tier].max_stations)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-3 text-gray-400">Users</td>
                  {TIER_ORDER.map((tier) => (
                    <td key={tier} className="py-3 text-center text-gray-300">
                      {limitLabel(TIER_STATIC_LIMITS[tier].max_users)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-3 text-gray-400">Songs</td>
                  {TIER_ORDER.map((tier) => (
                    <td key={tier} className="py-3 text-center text-gray-300">
                      {limitLabel(TIER_STATIC_LIMITS[tier].max_songs)}
                    </td>
                  ))}
                </tr>
                {FEATURES.map(({ key, label }) => (
                  <tr key={key}>
                    <td className="py-3 text-gray-400">{label}</td>
                    {TIER_ORDER.map((tier) => (
                      <td key={tier} className="py-3 text-center">
                        <div className="flex justify-center">
                          <CheckIcon
                            enabled={!!TIER_STATIC_LIMITS[tier][key as keyof TierLimits]}
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!isEnterprise && (
              <div className="mt-5 pt-5 border-t border-[#2a2a40] flex justify-center">
                <a
                  href="mailto:sales@playgen.site?subject=Upgrade%20Subscription"
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Contact Sales to Upgrade
                </a>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
