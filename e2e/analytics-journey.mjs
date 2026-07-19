#!/usr/bin/env node
/**
 * E2E: analytics — dashboard stats, station heatmap, overplayed/underplayed,
 * category distribution, song play history.
 */
import { createRunner, finish } from './lib.mjs';

const r = createRunner('analytics');
const { assert, api, setStep } = r;

async function main() {
  setStep(1, 'login + station');
  const { companyId } = await r.login();
  const station = await r.ensureStation(companyId);

  setStep(2, 'dashboard stats');
  const stats = await api('/api/v1/dashboard/stats');
  assert(stats.status === 200, 'GET /dashboard/stats returns 200', stats);
  assert(stats.data && typeof stats.data === 'object', 'stats is an object');

  setStep(3, 'rotation heatmap');
  const heatmap = await api(`/api/v1/stations/${station.id}/analytics/heatmap`);
  assert(heatmap.status === 200, 'GET analytics/heatmap returns 200', heatmap);

  setStep(4, 'overplayed report');
  const over = await api(`/api/v1/stations/${station.id}/analytics/overplayed`);
  assert(over.status === 200, 'GET analytics/overplayed returns 200', over);

  setStep(5, 'underplayed report');
  const under = await api(`/api/v1/stations/${station.id}/analytics/underplayed`);
  assert(under.status === 200, 'GET analytics/underplayed returns 200', under);

  setStep(6, 'category distribution');
  const dist = await api(`/api/v1/stations/${station.id}/analytics/category-distribution`);
  assert(dist.status === 200, 'GET analytics/category-distribution returns 200', dist);

  setStep(7, 'song play history');
  // Use any song if one exists; endpoint must 200 (empty history) or 404 for unknown id.
  const songs = await api(`/api/v1/stations/${station.id}/songs`);
  const list = Array.isArray(songs.data) ? songs.data : songs.data?.data ?? [];
  if (list[0]) {
    const hist = await api(`/api/v1/songs/${list[0].id}/history`);
    assert(hist.status === 200, 'GET /songs/:id/history returns 200', hist);
  } else {
    console.log('  (no songs in library — skipping per-song history read)');
  }

  setStep(8, 'analytics rejects unauthenticated access');
  const anon = await api('/api/v1/dashboard/stats', { auth: false, headers: { authorization: '' } });
  assert(anon.status === 401, 'dashboard stats without token returns 401', anon);

  finish('analytics');
}

main().catch(err => { console.error('\n✗ FAIL [analytics] unhandled error'); console.error(err); process.exit(1); });
