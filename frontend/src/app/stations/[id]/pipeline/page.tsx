'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface StageData {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at?: string;
  completed_at?: string;
  error?: string;
  progress?: number;
  step?: string;
  metadata?: Record<string, unknown>;
}

interface PipelineRun {
  id: string;
  station_id: string;
  playlist_id: string | null;
  script_id: string | null;
  date: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  triggered_by: string;
  stage_playlist: StageData;
  stage_dj_script: StageData;
  stage_review: StageData;
  stage_tts: StageData;
  stage_publish: StageData;
  created_at: string;
  updated_at: string;
}

const STAGES = [
  { key: 'stage_playlist', label: 'Playlist', icon: '🎵' },
  { key: 'stage_dj_script', label: 'DJ Script', icon: '🎙️' },
  { key: 'stage_review', label: 'Review', icon: '✍️' },
  { key: 'stage_tts', label: 'TTS Audio', icon: '🔊' },
  { key: 'stage_publish', label: 'Publish', icon: '📡' },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(status: StageData['status']): string {
  switch (status) {
    case 'completed': return '✓';
    case 'running': return '●';
    case 'failed': return '✗';
    case 'skipped': return '—';
    default: return '○';
  }
}

function statusColor(status: StageData['status']): string {
  switch (status) {
    case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'running': return 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse';
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'skipped': return 'bg-zinc-700/30 text-zinc-500 border-zinc-600/30';
    default: return 'bg-zinc-800/30 text-zinc-500 border-zinc-700/30';
  }
}

function runStatusBadge(status: PipelineRun['status']): string {
  switch (status) {
    case 'completed': return 'bg-green-500/20 text-green-400';
    case 'running': return 'bg-blue-500/20 text-blue-400';
    case 'failed': return 'bg-red-500/20 text-red-400';
    case 'cancelled': return 'bg-zinc-600/20 text-zinc-400';
    default: return 'bg-zinc-700 text-zinc-400';
  }
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Components ───────────────────────────────────────────────────────────────

function StageBox({ stage, data, expanded, onToggle }: {
  stage: typeof STAGES[number];
  data: StageData;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <button
        onClick={onToggle}
        className={`w-24 h-20 rounded-lg border flex flex-col items-center justify-center gap-1 transition-all hover:brightness-125 cursor-pointer ${statusColor(data.status)} ${expanded ? 'ring-2 ring-blue-400/50' : ''}`}
      >
        <span className="text-lg font-bold">{statusIcon(data.status)}</span>
        <span className="text-xs font-medium">{stage.label}</span>
        {data.status === 'running' && data.progress != null && (
          <span className="text-[10px] opacity-75">{data.progress}%</span>
        )}
        {data.status === 'completed' && (
          <span className="text-[10px] opacity-75">{formatDuration(data.started_at, data.completed_at)}</span>
        )}
      </button>
    </div>
  );
}

function StageDetail({ stage, data, onRetry, retrying }: {
  stage: typeof STAGES[number];
  data: StageData;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (data.status === 'pending') return null;
  return (
    <div className="mt-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{stage.icon}</span>
        <span className="font-semibold text-zinc-200">{stage.label}</span>
        <span className={`px-2 py-0.5 rounded text-xs ${statusColor(data.status)}`}>
          {data.status}
        </span>
        {data.status === 'failed' && onRetry && (
          <button
            onClick={onRetry}
            disabled={retrying}
            className="ml-auto px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 text-white text-xs font-medium rounded transition-colors"
          >
            {retrying ? 'Retrying...' : 'Retry'}
          </button>
        )}
      </div>
      {data.step && (
        <p className="text-zinc-400 text-xs mb-1">{data.step}</p>
      )}
      {data.started_at && (
        <p className="text-zinc-500 text-xs">
          Started: {formatTime(data.started_at)}
          {data.completed_at && ` — Completed: ${formatTime(data.completed_at)}`}
          {data.started_at && ` — Duration: ${formatDuration(data.started_at, data.completed_at)}`}
        </p>
      )}
      {data.status === 'running' && data.progress != null && (
        <div className="mt-2 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${data.progress}%` }}
          />
        </div>
      )}
      {data.error && (
        <pre className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 overflow-x-auto whitespace-pre-wrap">
          {data.error}
        </pre>
      )}
    </div>
  );
}

function PipelineRunCard({ run, isActive, stationId, onRefresh }: {
  run: PipelineRun;
  isActive: boolean;
  stationId: string;
  onRefresh: () => void;
}) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [retryingStage, setRetryingStage] = useState<string | null>(null);

  const stages = STAGES.map(s => ({
    ...s,
    data: run[s.key] as StageData,
  }));

  const totalDuration = formatDuration(run.created_at, run.status === 'running' ? undefined : run.updated_at);

  const handleRetry = async (stageKey: string) => {
    const stageName = stageKey.replace('stage_', '');
    setRetryingStage(stageKey);
    try {
      await api.post(`/api/v1/stations/${stationId}/pipeline/runs/${run.id}/retry/${stageName}`, {});
      onRefresh();
    } catch {
      // Error handled by polling refresh
    } finally {
      setRetryingStage(null);
    }
  };

  return (
    <div className={`p-4 rounded-xl border ${isActive ? 'border-blue-500/30 bg-zinc-900/80' : 'border-zinc-800 bg-zinc-900/40'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-zinc-300 font-medium">
            {new Date(run.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${runStatusBadge(run.status)}`}>
            {run.status}
          </span>
          <span className="text-xs text-zinc-500">{run.triggered_by}</span>
        </div>
        <span className="text-xs text-zinc-500 font-mono">{totalDuration}</span>
      </div>

      {/* Stage pipeline */}
      <div className="flex items-center justify-center gap-2">
        {stages.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <StageBox
              stage={s}
              data={s.data}
              expanded={expandedStage === s.key}
              onToggle={() => setExpandedStage(expandedStage === s.key ? null : s.key)}
            />
            {i < stages.length - 1 && (
              <div className={`w-6 h-0.5 ${s.data.status === 'completed' ? 'bg-green-500/40' : 'bg-zinc-700'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Expanded stage detail */}
      {expandedStage && (
        <StageDetail
          stage={stages.find(s => s.key === expandedStage)!}
          data={stages.find(s => s.key === expandedStage)!.data}
          onRetry={stages.find(s => s.key === expandedStage)!.data.status === 'failed'
            ? () => handleRetry(expandedStage)
            : undefined}
          retrying={retryingStage === expandedStage}
        />
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const params = useParams();
  const stationId = params.id as string;

  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasActiveRun = runs.some(r => r.status === 'running');

  const fetchRuns = useCallback(async () => {
    try {
      const data = await api.get<{ runs: PipelineRun[]; total: number }>(
        `/api/v1/stations/${stationId}/pipeline/runs?limit=20`,
      );
      setRuns(data.runs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pipeline runs');
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  // Initial load + polling for active runs
  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = setInterval(fetchRuns, 2000);
    return () => clearInterval(interval);
  }, [hasActiveRun, fetchRuns]);

  const triggerPipeline = async () => {
    setTriggering(true);
    try {
      await api.post(`/api/v1/stations/${stationId}/pipeline/trigger`, {});
      await fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger pipeline');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/stations/${stationId}`} className="text-zinc-500 hover:text-zinc-300 text-sm">
              Station
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-200 font-semibold">Pipeline</span>
          </div>
          <p className="text-xs text-zinc-500">Radio Program Factory — end-to-end pipeline runs</p>
        </div>
        <button
          onClick={triggerPipeline}
          disabled={triggering || hasActiveRun}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {triggering ? 'Triggering...' : hasActiveRun ? 'Pipeline Running...' : 'Trigger Pipeline'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          Loading pipeline runs...
        </div>
      )}

      {/* Empty state */}
      {!loading && runs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <p className="text-lg mb-2">No pipeline runs yet</p>
          <p className="text-sm">Click "Trigger Pipeline" to start your first run</p>
        </div>
      )}

      {/* Runs list */}
      <div className="space-y-4">
        {runs.map(run => (
          <PipelineRunCard key={run.id} run={run} isActive={run.status === 'running'} stationId={stationId} onRefresh={fetchRuns} />
        ))}
      </div>
    </div>
  );
}
