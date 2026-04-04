'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

type DaypartName = 'overnight' | 'morning' | 'midday' | 'afternoon' | 'evening';

interface DaypartAssignment {
  id: string;
  station_id: string;
  dj_profile_id: string | null;
  daypart: DaypartName;
  start_hour: number;
  end_hour: number;
}

interface DjProfile {
  id: string;
  name: string;
  voice_style: string;
  is_default: boolean;
  is_active: boolean;
}

const DAYPART_DEFINITIONS: { name: DaypartName; label: string; start_hour: number; end_hour: number; icon: string }[] = [
  { name: 'overnight', label: 'Overnight', start_hour: 0, end_hour: 6, icon: '🌙' },
  { name: 'morning', label: 'Morning', start_hour: 6, end_hour: 12, icon: '🌅' },
  { name: 'midday', label: 'Midday', start_hour: 12, end_hour: 15, icon: '☀️' },
  { name: 'afternoon', label: 'Afternoon', start_hour: 15, end_hour: 19, icon: '🌤' },
  { name: 'evening', label: 'Evening', start_hour: 19, end_hour: 23, icon: '🌆' },
];

function formatHour(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

export default function DaypartAssignmentsPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();
  const stationId = currentUser?.station_ids?.[0] ?? null;

  const [assignments, setAssignments] = useState<DaypartAssignment[]>([]);
  const [profiles, setProfiles] = useState<DjProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalDaypart, setModalDaypart] = useState<DaypartName | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) { router.replace('/login'); return; }
    if (!stationId) {
      setError('No station associated with your account.');
      setLoading(false);
      return;
    }
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [assignmentsData, profilesData] = await Promise.all([
        api.get<DaypartAssignment[]>(`/api/v1/dj/stations/${stationId}/dayparts`),
        api.get<DjProfile[]>('/api/v1/dj/profiles'),
      ]);
      setAssignments(assignmentsData);
      setProfiles(profilesData.filter((p) => p.is_active));
    } catch (err: unknown) {
      setError((err as ApiError).message ?? 'Failed to load daypart data');
    } finally {
      setLoading(false);
    }
  }

  function getAssignment(daypart: DaypartName): DaypartAssignment | undefined {
    return assignments.find((a) => a.daypart === daypart);
  }

  function getProfile(profileId: string | null | undefined): DjProfile | undefined {
    if (!profileId) return undefined;
    return profiles.find((p) => p.id === profileId);
  }

  function openModal(daypart: DaypartName) {
    const assignment = getAssignment(daypart);
    setModalDaypart(daypart);
    setSelectedProfileId(assignment?.dj_profile_id ?? '');
    setSaveError(null);
  }

  function closeModal() {
    setModalDaypart(null);
    setSelectedProfileId('');
    setSaveError(null);
  }

  async function handleSave() {
    if (!modalDaypart || !stationId) return;
    setSaving(true);
    setSaveError(null);
    const def = DAYPART_DEFINITIONS.find((d) => d.name === modalDaypart)!;
    try {
      if (selectedProfileId) {
        await api.put(`/api/v1/dj/stations/${stationId}/dayparts/${modalDaypart}`, {
          dj_profile_id: selectedProfileId,
          start_hour: def.start_hour,
          end_hour: def.end_hour,
        });
      } else {
        await api.delete(`/api/v1/dj/stations/${stationId}/dayparts/${modalDaypart}`);
      }
      await fetchData();
      closeModal();
    } catch (err: unknown) {
      setSaveError((err as ApiError).message ?? 'Failed to save assignment');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-[#0b0b10]">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Daypart Assignments</h1>
          <p className="text-sm text-gray-500 mt-1">Assign DJ profiles to time blocks throughout the day</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* 24-hour visual timeline */}
      <div className="card p-4 mb-6 border border-[#2a2a40]">
        <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">24-Hour Overview</p>
        <div className="relative h-8 flex rounded-md overflow-hidden">
          {DAYPART_DEFINITIONS.map((def) => {
            const assignment = getAssignment(def.name);
            const profile = getProfile(assignment?.dj_profile_id);
            const widthPct = ((def.end_hour - def.start_hour) / 24) * 100;
            return (
              <div
                key={def.name}
                style={{ width: `${widthPct}%` }}
                title={`${def.label}: ${profile?.name ?? 'Unassigned'}`}
                className={`flex items-center justify-center text-xs font-medium transition-opacity ${
                  profile
                    ? 'bg-violet-600/70 text-violet-100 border-r border-violet-800/50'
                    : 'bg-[#2a2a40] text-gray-600 border-r border-[#1a1a2e]'
                }`}
              >
                <span className="truncate px-1">{profile?.name ?? '—'}</span>
              </div>
            );
          })}
        </div>
        <div className="flex text-xs text-gray-600 mt-1">
          <span>12 AM</span>
          <span className="ml-auto">11 PM</span>
        </div>
      </div>

      {/* Daypart table */}
      <div className="card border border-[#2a2a40] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a2a40]">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-8"></th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Daypart</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Time Range</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned DJ</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Voice Style</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2a40]">
            {DAYPART_DEFINITIONS.map((def) => {
              const assignment = getAssignment(def.name);
              const profile = getProfile(assignment?.dj_profile_id);
              return (
                <tr key={def.name} className="hover:bg-[#1a1a2e]/40 transition-colors">
                  <td className="px-4 py-4 text-lg">{def.icon}</td>
                  <td className="px-4 py-4">
                    <span className="text-white font-medium capitalize">{def.label}</span>
                  </td>
                  <td className="px-4 py-4 text-gray-400">
                    {formatHour(def.start_hour)} – {formatHour(def.end_hour)}
                  </td>
                  <td className="px-4 py-4">
                    {profile ? (
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-violet-600/30 flex items-center justify-center text-violet-300 text-xs font-bold">
                          {profile.name[0]}
                        </div>
                        <span className="text-white">{profile.name}</span>
                        {profile.is_default && (
                          <span className="text-xs bg-violet-900/30 text-violet-400 px-1.5 py-0.5 rounded">Default</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-600 italic">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {profile ? (
                      <span className="text-xs text-gray-400 capitalize">{profile.voice_style}</span>
                    ) : (
                      <span className="text-gray-700">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <button
                      onClick={() => openModal(def.name)}
                      className="text-xs text-violet-400 hover:text-violet-300 font-medium px-3 py-1.5 rounded-md border border-violet-800/50 hover:border-violet-600/50 transition-colors"
                    >
                      {profile ? 'Change' : 'Assign'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {profiles.length === 0 && !loading && (
        <div className="mt-4 bg-yellow-900/20 border border-yellow-700/40 text-yellow-400 px-4 py-3 rounded-lg text-sm">
          No active DJ profiles found.{' '}
          <a href="/dj" className="underline hover:text-yellow-300">
            Create a profile
          </a>{' '}
          before assigning dayparts.
        </div>
      )}

      {/* Assignment Modal */}
      {modalDaypart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-[#16161f] border border-[#2a2a40] rounded-2xl shadow-2xl p-6">
            {(() => {
              const def = DAYPART_DEFINITIONS.find((d) => d.name === modalDaypart)!;
              return (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl">{def.icon}</span>
                    <div>
                      <h2 className="text-base font-semibold text-white capitalize">{def.label}</h2>
                      <p className="text-xs text-gray-500">
                        {formatHour(def.start_hour)} – {formatHour(def.end_hour)}
                      </p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="text-xs text-gray-500 font-medium block mb-1.5">
                      DJ Profile
                    </label>
                    <select
                      value={selectedProfileId}
                      onChange={(e) => setSelectedProfileId(e.target.value)}
                      className="input w-full"
                    >
                      <option value="">— None (unassign) —</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.is_default ? ' (Default)' : ''} — {p.voice_style}
                        </option>
                      ))}
                    </select>
                  </div>

                  {saveError && (
                    <div className="mb-4 bg-red-900/30 border border-red-700/50 text-red-400 px-3 py-2 rounded-lg text-xs">
                      {saveError}
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button onClick={closeModal} className="btn-secondary text-sm">
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
