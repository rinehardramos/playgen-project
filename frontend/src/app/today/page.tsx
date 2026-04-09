'use client';

/**
 * /today — unified landing for Program Directors, Music Directors, and Board Ops.
 *
 * See docs/user-journey-programs-logs.md for the rationale. This is the navigational
 * skeleton: it uses existing endpoints only (no schema or engine changes). Follow-up
 * tickets add the now-playing WebSocket, generate-day orchestration, and reverse
 * log→program query.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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

interface Playlist {
  id: string;
  date: string;
  status: 'draft' | 'generating' | 'ready' | 'approved' | 'exported' | 'failed';
  station_id: string;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentWeekday(): string {
  return DAY_NAMES[new Date().getDay()];
}

function formatHour(h: number): string {
  const hh = h % 24;
  if (hh === 0) return '12 AM';
  if (hh === 12) return '12 PM';
  return hh < 12 ? `${hh} AM` : `${hh - 12} PM`;
}

/**
 * Compute which program (if any) owns a given hour for the current weekday.
 * Handles the simple non-wrapping case. end_hour is exclusive (e.g. 6-10 = 6,7,8,9).
 */
function programForHour(programs: Program[], weekday: string, hour: number): Program | null {
  for (const p of programs) {
    if (!p.is_active || p.is_default) continue;
    if (!p.active_days.includes(weekday)) continue;
    if (hour >= p.start_hour && hour < p.end_hour) return p;
  }
  return null;
}

interface Band {
  program: Program | null;
  startHour: number;
  endHour: number;
}

function computeBands(programs: Program[], weekday: string): Band[] {
  const bands: Band[] = [];
  let cursor = 0;
  while (cursor < 24) {
    const owner = programForHour(programs, weekday, cursor);
    let end = cursor + 1;
    while (end < 24 && programForHour(programs, weekday, end)?.id === owner?.id) end++;
    bands.push({ program: owner, startHour: cursor, endHour: end });
    cursor = end;
  }
  return bands;
}

export default function TodayPage() {
  const router = useRouter();
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [programs, setPrograms] = useState<Program[]>([]);
  const [todayLog, setTodayLog] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  // Tick every 60s to refresh the Now Playing card cheaply.
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }
    api.get<Station[]>(`/api/v1/companies/${user.company_id}/stations`)
      .then((list) => {
        setStations(list);
        if (list.length > 0) setSelectedStation(list[0].id);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!selectedStation) return;
    setLoading(true);
    const iso = todayISO();

    Promise.all([
      api.get<Program[]>(`/api/v1/stations/${selectedStation}/programs`).catch(() => []),
      api.get<Playlist[]>(`/api/v1/stations/${selectedStation}/playlists?date=${iso}`).catch(() => []),
    ])
      .then(([progs, logs]) => {
        setPrograms(progs);
        const match = logs[0] ?? null;
        setTodayLog(match);
      })
      .finally(() => setLoading(false));
  }, [selectedStation]);

  const weekday = currentWeekday();
  const currentHour = now.getHours();
  const bands = useMemo(() => computeBands(programs, weekday), [programs, weekday]);
  const nowProgram = programForHour(programs, weekday, currentHour);
  const gaps = bands.filter((b) => !b.program);
  const namedPrograms = programs.filter((p) => !p.is_default);

  // Next up: find the next band after the current hour that has a program
  const nextBand = bands.find((b) => b.startHour > currentHour && b.program) ?? null;

  const user = getCurrentUser();

  const refreshPrograms = useCallback(() => {
    if (!selectedStation) return;
    api.get<Program[]>(`/api/v1/stations/${selectedStation}/programs`)
      .then(setPrograms)
      .catch(() => {/* non-critical refresh — ignore transient errors */});
  }, [selectedStation]);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Today</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {' · '}
            {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
        {stations.length > 1 && (
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="bg-[#1a1a2e] border border-[#2a2a40] text-gray-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
        </div>
      ) : stations.length === 0 ? (
        <EmptyState
          title="No stations yet"
          body="Programs and Logs live inside a station. Create one to get started."
          cta={{ href: '/stations', label: 'Set up a station' }}
        />
      ) : namedPrograms.length === 0 ? (
        <EmptyState
          title="No programs scheduled"
          body={`Define recurring shows like "Morning Rush" or "Afternoon Drive" to give ${user?.display_name ? 'your team' : 'the team'} a clear daily structure.`}
          cta={{ href: '/programs/new', label: 'Create your first program' }}
        />
      ) : (
        <div className="space-y-6">
          {/* Now Playing + Next Up cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NowPlayingCard program={nowProgram} hour={currentHour} stationId={selectedStation} />
            <NextUpCard band={nextBand} />
          </div>

          {/* Timeline */}
          <Timeline bands={bands} currentHour={currentHour} />

          {/* Coverage gaps alert */}
          {gaps.length > 0 && (
            <GapAlert gaps={gaps} stationId={selectedStation} onGapFixed={refreshPrograms} />
          )}

          {/* Today's log quick actions */}
          <TodayLogCard log={todayLog} stationId={selectedStation} />
        </div>
      )}
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function EmptyState({ title, body, cta }: { title: string; body: string; cta: { href: string; label: string } }) {
  return (
    <div className="text-center py-20">
      <div className="w-16 h-16 bg-violet-600/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      </div>
      <h3 className="text-white font-semibold mb-2">{title}</h3>
      <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">{body}</p>
      <Link href={cta.href} className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
        {cta.label}
      </Link>
    </div>
  );
}

function NowPlayingCard({ program, hour, stationId }: { program: Program | null; hour: number; stationId: string }) {
  const color = program?.color_tag ?? '#334155';
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Now Playing</span>
        <span className="text-xs text-gray-600">{formatHour(hour)}</span>
      </div>
      {program ? (
        <>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <h3 className="text-white font-semibold truncate">{program.name}</h3>
          </div>
          <p className="text-gray-500 text-xs mb-4">
            {formatHour(program.start_hour)} – {formatHour(program.end_hour)}
          </p>
          <Link
            href={`/programs/${program.id}/clock`}
            className="inline-block text-xs text-violet-400 hover:text-violet-300 font-medium"
          >
            Open clock →
          </Link>
        </>
      ) : (
        <>
          <p className="text-gray-400 text-sm mb-2">No program covers this hour.</p>
          <Link href={`/programs/new`} className="text-xs text-violet-400 hover:text-violet-300 font-medium">
            Schedule one →
          </Link>
        </>
      )}
      {/* stationId reserved for the T-I DJ profile + T-D SSE follow-up */}
      <span className="sr-only" data-station={stationId} />
    </div>
  );
}

function NextUpCard({ band }: { band: Band | null }) {
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Next Up</span>
        {band && <span className="text-xs text-gray-600">{formatHour(band.startHour)}</span>}
      </div>
      {band?.program ? (
        <>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: band.program.color_tag ?? '#7c3aed' }} />
            <h3 className="text-white font-semibold truncate">{band.program.name}</h3>
          </div>
          <p className="text-gray-500 text-xs">
            Airs {formatHour(band.startHour)} – {formatHour(band.endHour)}
          </p>
        </>
      ) : (
        <p className="text-gray-400 text-sm">Nothing else scheduled today.</p>
      )}
    </div>
  );
}

function Timeline({ bands, currentHour }: { bands: Band[]; currentHour: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Today&apos;s Timeline</h2>
        <span className="text-xs text-gray-600">Tap a band to jump to its program</span>
      </div>
      <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-4 overflow-hidden">
        <div className="flex h-12 rounded-lg overflow-hidden">
          {bands.map((band, i) => {
            const widthPct = ((band.endHour - band.startHour) / 24) * 100;
            const bg = band.program?.color_tag ?? '#1e1e2e';
            const isCurrent = currentHour >= band.startHour && currentHour < band.endHour;
            const inner = (
              <div
                className={`h-full flex items-center justify-center text-[10px] font-medium transition-opacity hover:opacity-80 ${
                  band.program ? 'text-white' : 'text-gray-600 border border-dashed border-[#2a2a40]'
                } ${isCurrent ? 'ring-2 ring-white/40 ring-inset' : ''}`}
                style={{ width: `${widthPct}%`, backgroundColor: bg }}
                title={band.program ? `${band.program.name} (${formatHour(band.startHour)}–${formatHour(band.endHour)})` : `Uncovered ${formatHour(band.startHour)}–${formatHour(band.endHour)}`}
              >
                <span className="truncate px-1">
                  {band.program ? band.program.name : 'Uncovered'}
                </span>
              </div>
            );
            return band.program ? (
              <Link key={i} href={`/programs/${band.program.id}/clock`} style={{ width: `${widthPct}%` }}>
                {inner}
              </Link>
            ) : (
              <Link key={i} href={`/programs/new`} style={{ width: `${widthPct}%` }}>
                {inner}
              </Link>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-gray-600">
          <span>12 AM</span>
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
          <span>12 AM</span>
        </div>
      </div>
    </div>
  );
}

function GapAlert({
  gaps,
  stationId,
  onGapFixed,
}: {
  gaps: Band[];
  stationId: string;
  onGapFixed: () => void;
}) {
  const [fixing, setFixing] = useState<Record<string, boolean>>({});
  const [fixError, setFixError] = useState<string | null>(null);

  async function handleUseDefaultClock(gap: Band) {
    const key = `${gap.startHour}-${gap.endHour}`;
    setFixing((prev) => ({ ...prev, [key]: true }));
    setFixError(null);
    try {
      await api.post(`/api/v1/stations/${stationId}/programs`, {
        name: `Auto-fill ${formatHour(gap.startHour)}–${formatHour(gap.endHour)}`,
        description: 'Auto-created to fill coverage gap (station default clock)',
        active_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        start_hour: gap.startHour,
        end_hour: gap.endHour,
        is_default: true,
      });
      onGapFixed();
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? 'Failed to create program';
      setFixError(msg);
    } finally {
      setFixing((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <div className="bg-yellow-900/10 border border-yellow-700/30 rounded-xl px-4 py-3">
      <div className="flex items-start gap-3 mb-3">
        <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <div>
          <p className="text-sm text-yellow-200 font-medium">
            {gaps.length === 1 ? '1 hour range' : `${gaps.length} hour ranges`} not covered by a program today
          </p>
          <p className="text-xs text-yellow-300/70 mt-0.5">
            Fix each gap below or{' '}
            <Link href="/programs/new" className="text-yellow-300 hover:text-yellow-200 font-medium">
              create a custom program →
            </Link>
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {gaps.map((gap) => {
          const key = `${gap.startHour}-${gap.endHour}`;
          const isBusy = fixing[key] ?? false;
          return (
            <li
              key={key}
              className="flex items-center justify-between gap-3 bg-yellow-900/10 border border-yellow-700/20 rounded-lg px-3 py-2"
            >
              <span className="text-xs text-yellow-200 font-medium">
                {formatHour(gap.startHour)}–{formatHour(gap.endHour)}
              </span>
              <button
                onClick={() => handleUseDefaultClock(gap)}
                disabled={isBusy}
                className="text-xs bg-yellow-700/30 hover:bg-yellow-700/50 text-yellow-200 font-medium px-3 py-1 rounded transition-colors disabled:opacity-50"
              >
                {isBusy ? 'Creating…' : 'Use station default clock'}
              </button>
            </li>
          );
        })}
      </ul>

      {fixError && (
        <p className="mt-2 text-xs text-red-400">{fixError}</p>
      )}
    </div>
  );
}

function TodayLogCard({ log, stationId }: { log: Playlist | null; stationId: string }) {
  const STATUS_STYLES: Record<string, string> = {
    draft: 'bg-gray-800 text-gray-400',
    generating: 'bg-blue-900/30 text-blue-400',
    ready: 'bg-yellow-900/30 text-yellow-400',
    approved: 'bg-green-900/30 text-green-400',
    exported: 'bg-violet-900/30 text-violet-400',
    failed: 'bg-red-900/30 text-red-400',
  };
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a40] rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Today&apos;s Log</span>
        {log ? (
          <div className="flex items-center gap-3 mt-2">
            <h3 className="text-white font-semibold">Station log ready</h3>
            <span className={`text-xs px-2 py-0.5 rounded capitalize ${STATUS_STYLES[log.status] ?? ''}`}>{log.status}</span>
          </div>
        ) : (
          <p className="text-gray-400 text-sm mt-2">No log generated yet for today.</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {log ? (
          <Link
            href={`/playlists/${log.id}`}
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Open today&apos;s log
          </Link>
        ) : (
          <Link
            href={`/playlists`}
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Generate log
          </Link>
        )}
      </div>
      <span className="sr-only" data-station={stationId} />
    </div>
  );
}
