'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';

interface Program {
  id: string;
  name: string;
  station_id: string;
}

interface Episode {
  id: string;
  program_id: string;
  air_date: string;
  playlist_id: string | null;
  dj_script_id: string | null;
  manifest_id: string | null;
  status: 'draft' | 'generating' | 'ready' | 'approved' | 'aired';
  notes: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-700 text-gray-300',
  generating: 'bg-yellow-900 text-yellow-300',
  ready: 'bg-blue-900 text-blue-300',
  approved: 'bg-green-900 text-green-300',
  aired: 'bg-purple-900 text-purple-300',
};

export default function EpisodesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const programId = params.id;

  const [program, setProgram] = useState<Program | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) { router.push('/login'); return; }

    Promise.all([
      api.get<Program>(`/api/v1/programs/${programId}`),
      api.get<Episode[]>(`/api/v1/programs/${programId}/episodes`),
    ]).then(([prog, eps]) => {
      setProgram(prog);
      setEpisodes(eps);
    }).catch(() => setError('Failed to load episodes'))
      .finally(() => setLoading(false));
  }, [router, programId]);

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;
  if (!program) return <div className="p-8 text-gray-400">Program not found.</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <Link href="/programs" className="text-gray-500 hover:text-gray-300 text-sm">← Programs</Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-white">{program.name}</h1>
            <p className="text-gray-400 text-sm mt-1">Episode history and schedule</p>
          </div>
          <Link
            href="/playlists"
            className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded font-medium transition-colors"
          >
            Generate playlist →
          </Link>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {episodes.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No episodes yet</p>
          <p className="text-sm">
            Episodes are created automatically when you generate a log for this program&apos;s station.
            Head to <Link href="/playlists" className="text-violet-400 hover:underline">Logs</Link> to generate one.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {episodes.map((ep) => (
            <div key={ep.id} className="bg-gray-800 rounded-lg p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-white font-medium">{ep.air_date}</span>
                  <span className={`text-xs px-2 py-0.5 rounded capitalize ${STATUS_COLORS[ep.status] ?? 'bg-gray-700 text-gray-300'}`}>
                    {ep.status}
                  </span>
                </div>
                {ep.notes && <p className="text-gray-400 text-xs mt-1">{ep.notes}</p>}
              </div>
              <div className="flex items-center gap-3 text-sm shrink-0">
                {ep.playlist_id && (
                  <Link href={`/playlists/${ep.playlist_id}`} className="text-blue-400 hover:text-blue-300">
                    Open in Log
                  </Link>
                )}
                {ep.dj_script_id && (
                  <Link href={`/playlists/${ep.playlist_id}?tab=dj`} className="text-purple-400 hover:text-purple-300">
                    DJ Script
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
