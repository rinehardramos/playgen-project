'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface Station {
  id: string;
  name: string;
}

interface Program {
  id: string;
  station_id: string;
  name: string;
  description: string | null;
  active_days: string[];
  start_hour: number;
  end_hour: number;
  color_tag: string | null;
  is_active: boolean;
  is_default: boolean;
}

const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

const ALL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const PROGRAM_COLORS = [
  '#7c3aed', '#2563eb', '#059669', '#d97706',
  '#dc2626', '#db2777', '#0891b2', '#65a30d',
];

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

function ProgramCard({ program, onEdit }: { program: Program; onEdit: () => void }) {
  const color = program.color_tag ?? '#7c3aed';
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-5 hover:border-[#3a3a55] transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5"
            style={{ backgroundColor: color }}
          />
          <div className="min-w-0">
            <h3 className="text-white font-semibold truncate">{program.name}</h3>
            {program.description && (
              <p className="text-gray-500 text-xs truncate mt-0.5">{program.description}</p>
            )}
          </div>
        </div>
        {program.is_default && (
          <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded flex-shrink-0">default</span>
        )}
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          {ALL_DAYS.map(day => (
            <span
              key={day}
              className={`text-xs px-1.5 py-0.5 rounded ${
                program.active_days.includes(day)
                  ? 'text-white font-medium'
                  : 'text-gray-700'
              }`}
              style={program.active_days.includes(day) ? { backgroundColor: color + '33', color } : {}}
            >
              {DAY_LABELS[day]}
            </span>
          ))}
        </div>
        <p className="text-gray-400 text-xs">
          {formatHour(program.start_hour)} – {formatHour(program.end_hour)}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href={`/programs/${program.id}`}
          className="flex-1 text-center text-xs bg-[#12122a] hover:bg-[#1e1e3a] text-gray-300 px-3 py-2 rounded-lg transition-colors"
        >
          View Episodes
        </Link>
        <Link
          href={`/programs/${program.id}/clock`}
          className="flex-1 text-center text-xs bg-[#12122a] hover:bg-[#1e1e3a] text-gray-300 px-3 py-2 rounded-lg transition-colors"
        >
          Edit Clock
        </Link>
        {!program.is_default && (
          <button
            onClick={onEdit}
            className="text-xs text-gray-500 hover:text-gray-300 px-2 py-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProgramsPage() {
  const router = useRouter();
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Load stations
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }
    api.get<Station[]>(`/api/v1/companies/${user.company_id}/stations`)
      .then((list) => {
        setStations(list);
        if (list.length > 0) setSelectedStation(list[0].id);
      })
      .catch(() => {});
  }, [router]);

  const loadPrograms = useCallback(async () => {
    if (!selectedStation) return;
    setLoading(true);
    try {
      const data = await api.get<Program[]>(`/api/v1/stations/${selectedStation}/programs`);
      setPrograms(data);
    } catch {
      setPrograms([]);
    } finally {
      setLoading(false);
    }
  }, [selectedStation]);

  useEffect(() => { loadPrograms(); }, [loadPrograms]);

  const namedPrograms = programs.filter(p => !p.is_default);
  const defaultProgram = programs.find(p => p.is_default);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Programs</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage your recurring shows and their format clocks</p>
        </div>
        <div className="flex items-center gap-3">
          {stations.length > 1 && (
            <select
              value={selectedStation}
              onChange={e => setSelectedStation(e.target.value)}
              className="bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
            >
              {stations.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <Link
            href="/programs/new"
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
            </svg>
            New Program
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
        </div>
      ) : namedPrograms.length === 0 && !defaultProgram ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-violet-600/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
            </svg>
          </div>
          <h3 className="text-white font-semibold mb-2">No programs yet</h3>
          <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
            Programs organise your daily shows (Morning Rush, Afternoon Drive) and link music templates with DJ scripts via a Show Clock.
          </p>
          <Link
            href="/programs/new"
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            Create your first program
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {namedPrograms.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Your Shows</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {namedPrograms.map(p => (
                  <ProgramCard key={p.id} program={p} onEdit={() => setEditingId(p.id)} />
                ))}
              </div>
            </div>
          )}

          {defaultProgram && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Unassigned</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <ProgramCard key={defaultProgram.id} program={defaultProgram} onEdit={() => {}} />
              </div>
              <p className="text-gray-600 text-xs mt-2">
                Pre-existing playlists are grouped here. Reassign episodes to named programs from the episode view.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
