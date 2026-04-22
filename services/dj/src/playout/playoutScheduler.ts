import { getPool } from '../db.js';
import { getStorageAdapter } from '../lib/storage/index.js';
import type { ProgramManifest, ProgramManifestSegment } from '../services/manifestService.js';

export interface PlayoutState {
  stationId: string;
  manifest: ProgramManifest;
  startedAt: number;  // Unix timestamp (ms) when playout began
  currentSegmentIndex: number;
  isPlaying: boolean;
}

export interface NowPlaying {
  segment: ProgramManifestSegment;
  elapsed_sec: number;
  remaining_sec: number;
  next_segment?: ProgramManifestSegment;
}

/** In-memory map of active station playouts. */
const activePlayouts = new Map<string, PlayoutState>();

/** Event listeners for segment transitions. */
type SegmentChangeListener = (stationId: string, segment: ProgramManifestSegment, next?: ProgramManifestSegment) => void;
const listeners: SegmentChangeListener[] = [];

export function onSegmentChange(fn: SegmentChangeListener) {
  listeners.push(fn);
}

function notifyListeners(stationId: string, segment: ProgramManifestSegment, next?: ProgramManifestSegment) {
  for (const fn of listeners) {
    try { fn(stationId, segment, next); } catch { /* ignore listener errors */ }
  }
}

/**
 * Start playout for a station using its latest published episode manifest.
 */
export async function startPlayout(stationId: string): Promise<PlayoutState | null> {
  const pool = getPool();

  // Find the latest published episode with a manifest for this station
  const { rows: [episode] } = await pool.query(
    `SELECT pe.id, pe.air_date, m.manifest_url
     FROM program_episodes pe
     JOIN programs p ON p.id = pe.program_id
     JOIN dj_show_manifests m ON m.id = pe.manifest_id
     WHERE p.station_id = $1
       AND pe.published_at IS NOT NULL
       AND m.status = 'ready'
     ORDER BY pe.air_date DESC
     LIMIT 1`,
    [stationId],
  );

  if (!episode?.manifest_url) return null;

  // Load manifest from storage
  const storage = getStorageAdapter();
  const manifestBuffer = await storage.read(episode.manifest_url);
  const manifest: ProgramManifest = JSON.parse(manifestBuffer.toString());

  const state: PlayoutState = {
    stationId,
    manifest,
    startedAt: Date.now(),
    currentSegmentIndex: 0,
    isPlaying: true,
  };

  activePlayouts.set(stationId, state);
  startAdvanceTimer(stationId);

  return state;
}

/** Stop playout for a station. */
export function stopPlayout(stationId: string) {
  const state = activePlayouts.get(stationId);
  if (state) {
    state.isPlaying = false;
    activePlayouts.delete(stationId);
  }
  const timer = advanceTimers.get(stationId);
  if (timer) {
    clearTimeout(timer);
    advanceTimers.delete(stationId);
  }
}

/** Get current playback state. */
export function getNowPlaying(stationId: string): NowPlaying | null {
  const state = activePlayouts.get(stationId);
  if (!state || !state.isPlaying) return null;

  const elapsedMs = Date.now() - state.startedAt;
  const elapsedSec = elapsedMs / 1000;

  // Find which segment we should be playing based on elapsed time
  const segments = state.manifest.segments;
  let idx = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start_sec + segments[i].duration_sec > elapsedSec) {
      idx = i;
      break;
    }
    if (i === segments.length - 1) idx = i; // past the end
  }

  state.currentSegmentIndex = idx;
  const segment = segments[idx];
  const segmentElapsed = elapsedSec - segment.start_sec;
  const remaining = segment.duration_sec - segmentElapsed;
  const next = segments[idx + 1];

  return { segment, elapsed_sec: segmentElapsed, remaining_sec: Math.max(0, remaining), next_segment: next };
}

/** Get list of active playout stations. */
export function getActivePlayouts(): string[] {
  return Array.from(activePlayouts.keys());
}

/** Get the manifest for an active playout. */
export function getPlayoutManifest(stationId: string): ProgramManifest | null {
  return activePlayouts.get(stationId)?.manifest ?? null;
}

// ── Advance timer: fires when current segment ends ──────────────────────────

const advanceTimers = new Map<string, NodeJS.Timeout>();

function startAdvanceTimer(stationId: string) {
  const state = activePlayouts.get(stationId);
  if (!state || !state.isPlaying) return;

  const segments = state.manifest.segments;
  const segment = segments[state.currentSegmentIndex];
  if (!segment) return;

  const elapsedMs = Date.now() - state.startedAt;
  const segmentEndMs = (segment.start_sec + segment.duration_sec) * 1000;
  const delay = Math.max(0, segmentEndMs - elapsedMs);

  // Notify about current segment immediately
  const next = segments[state.currentSegmentIndex + 1];
  notifyListeners(stationId, segment, next);

  const timer = setTimeout(() => {
    const s = activePlayouts.get(stationId);
    if (!s || !s.isPlaying) return;

    s.currentSegmentIndex++;
    if (s.currentSegmentIndex >= segments.length) {
      // End of manifest — stop playout
      stopPlayout(stationId);
      return;
    }

    startAdvanceTimer(stationId); // Schedule next transition
  }, delay);

  advanceTimers.set(stationId, timer);
}
