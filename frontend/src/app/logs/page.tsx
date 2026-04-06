'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error';
type LogCategory = 'dj' | 'tts' | 'review' | 'config' | 'playlist' | 'auth' | 'system';

interface Station {
  id: string;
  name: string;
}

interface SystemLogEntry {
  id: string;
  created_at: string;
  level: LogLevel;
  category: LogCategory;
  company_id: string | null;
  station_id: string | null;
  user_id: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
}

interface LogsResponse {
  data: SystemLogEntry[];
  total: number;
  page: number;
  pages: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LEVEL_STYLES: Record<LogLevel, string> = {
  info:  'bg-blue-900/30 text-blue-300 border border-blue-500/30',
  warn:  'bg-amber-900/30 text-amber-300 border border-amber-500/30',
  error: 'bg-red-900/30 text-red-300 border border-red-500/30',
};

const ROW_BG: Record<LogLevel, string> = {
  info:  '',
  warn:  'bg-amber-950/20',
  error: 'bg-red-950/20',
};

const CATEGORY_STYLES: Record<LogCategory, string> = {
  dj:       'bg-violet-900/30 text-violet-300',
  tts:      'bg-purple-900/30 text-purple-300',
  review:   'bg-cyan-900/30 text-cyan-300',
  config:   'bg-slate-700/50 text-slate-300',
  playlist: 'bg-green-900/30 text-green-300',
  auth:     'bg-yellow-900/30 text-yellow-300',
  system:   'bg-gray-700/50 text-gray-300',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const router = useRouter();
  const user = typeof window !== 'undefined' ? getCurrentUser() : null;

  const [stations, setStations] = useState<Station[]>([]);
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [filterLevel, setFilterLevel]       = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStation, setFilterStation]   = useState('');
  const [filterFrom, setFilterFrom]         = useState('');
  const [filterTo, setFilterTo]             = useState('');

  // Expanded rows (show metadata JSON)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Station name lookup
  const stationName = useCallback(
    (id: string | null) => stations.find((s) => s.id === id)?.name ?? id ?? '—',
    [stations],
  );

  // Redirect non-admins
  useEffect(() => {
    if (!user) { router.replace('/login'); return; }
    const adminRoles = ['super_admin', 'company_admin', 'station_admin', 'general_manager'];
    if (!adminRoles.includes(user.role_code)) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  // Load stations for filter dropdown
  useEffect(() => {
    if (!user?.company_id) return;
    api.get<Station[]>(`/api/v1/companies/${user.company_id}/stations`)
      .then(setStations)
      .catch(() => {/* non-fatal */});
  }, [user?.company_id]);

  // Fetch logs whenever filters or page change
  const fetchLogs = useCallback(async () => {
    if (!user?.company_id) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (filterLevel)    params.set('level', filterLevel);
      if (filterCategory) params.set('category', filterCategory);
      if (filterStation)  params.set('station_id', filterStation);
      if (filterFrom)     params.set('from', filterFrom);
      if (filterTo)       params.set('to', filterTo);

      const result = await api.get<LogsResponse>(
        `/api/v1/companies/${user.company_id}/logs?${params.toString()}`,
      );
      setLogs(result.data);
      setTotal(result.total);
      setPages(result.pages);
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [user?.company_id, page, filterLevel, filterCategory, filterStation, filterFrom, filterTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Reset to page 1 when filters change
  const applyFilter = useCallback((setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  }, []);

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">System Logs</h1>
          <p className="text-gray-400 text-sm mt-1">Audit trail for notifications, errors, and config changes</p>
        </div>
        <span className="text-xs text-gray-500">
          {total > 0 ? `${total.toLocaleString()} entries` : ''}
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3">
        {/* Level */}
        <select
          value={filterLevel}
          onChange={(e) => applyFilter(setFilterLevel)(e.target.value)}
          className="bg-[#1e1e2e] border border-[#2a2a40] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="">All Levels</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>

        {/* Category */}
        <select
          value={filterCategory}
          onChange={(e) => applyFilter(setFilterCategory)(e.target.value)}
          className="bg-[#1e1e2e] border border-[#2a2a40] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="">All Categories</option>
          <option value="dj">DJ</option>
          <option value="tts">TTS</option>
          <option value="review">Review</option>
          <option value="config">Config</option>
          <option value="playlist">Playlist</option>
          <option value="auth">Auth</option>
          <option value="system">System</option>
        </select>

        {/* Station */}
        <select
          value={filterStation}
          onChange={(e) => applyFilter(setFilterStation)(e.target.value)}
          className="bg-[#1e1e2e] border border-[#2a2a40] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="">All Stations</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* From date */}
        <input
          type="datetime-local"
          value={filterFrom}
          onChange={(e) => applyFilter(setFilterFrom)(e.target.value)}
          placeholder="From"
          className="bg-[#1e1e2e] border border-[#2a2a40] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />

        {/* To date */}
        <input
          type="datetime-local"
          value={filterTo}
          onChange={(e) => applyFilter(setFilterTo)(e.target.value)}
          placeholder="To"
          className="bg-[#1e1e2e] border border-[#2a2a40] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />

        {/* Clear filters */}
        {(filterLevel || filterCategory || filterStation || filterFrom || filterTo) && (
          <button
            onClick={() => {
              setFilterLevel('');
              setFilterCategory('');
              setFilterStation('');
              setFilterFrom('');
              setFilterTo('');
              setPage(1);
            }}
            className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 border border-[#2a2a40] rounded-lg transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[#2a2a40] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1a1a28] border-b border-[#2a2a40] text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left w-44">Timestamp</th>
                <th className="px-4 py-3 text-left w-20">Level</th>
                <th className="px-4 py-3 text-left w-24">Category</th>
                <th className="px-4 py-3 text-left w-36">Station</th>
                <th className="px-4 py-3 text-left">Message</th>
                <th className="px-4 py-3 text-left w-16">Meta</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-500" />
                    </div>
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    No log entries found
                  </td>
                </tr>
              )}
              {!loading && logs.map((log) => (
                <Fragment key={log.id}>
                  <tr
                    className={`border-b border-[#2a2a40] hover:bg-[#1e1e2e] transition-colors cursor-pointer ${ROW_BG[log.level]}`}
                    onClick={() => log.metadata && toggleRow(log.id)}
                  >
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap font-mono">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase ${LEVEL_STYLES[log.level]}`}>
                        {log.level}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_STYLES[log.category]}`}>
                        {log.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300 text-xs truncate max-w-[144px]">
                      {stationName(log.station_id)}
                    </td>
                    <td className="px-4 py-3 text-gray-200">
                      {log.message}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {log.metadata && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleRow(log.id); }}
                          className="text-gray-500 hover:text-violet-400 transition-colors"
                          title={expanded.has(log.id) ? 'Collapse' : 'Expand metadata'}
                        >
                          {expanded.has(log.id) ? (
                            <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                            </svg>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Expanded metadata row */}
                  {expanded.has(log.id) && log.metadata && (
                    <tr className={`border-b border-[#2a2a40] ${ROW_BG[log.level]}`}>
                      <td colSpan={6} className="px-6 py-3">
                        <pre className="text-xs text-gray-300 bg-[#0d0d14] rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all font-mono border border-[#2a2a40]">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>
            Page {page} of {pages} &mdash; {total.toLocaleString()} total entries
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-[#2a2a40] hover:bg-[#1e1e2e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>

            {/* Page number buttons — show at most 7 pages around current */}
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === '...' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-600">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`px-3 py-1.5 rounded-lg border transition-colors ${
                      p === page
                        ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
                        : 'border-[#2a2a40] hover:bg-[#1e1e2e]'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}

            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="px-3 py-1.5 rounded-lg border border-[#2a2a40] hover:bg-[#1e1e2e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
