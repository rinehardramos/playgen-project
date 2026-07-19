#!/usr/bin/env node
/**
 * E2E: scheduling & playlists — rotation rules, station config, playlist
 * generation end-to-end (library + template + generate + job poll), playlist
 * read/notes/approve, CSV + XLSX export, delete.
 *
 * Builds its own disposable station so generation can't collide with other
 * journeys' data or historical playlists.
 */
import { createRunner, finish } from './lib.mjs';

const r = createRunner('scheduler');
const { assert, api, setStep, waitFor } = r;

async function main() {
  setStep(1, 'login + fresh station');
  const { companyId } = await r.login();
  const stCreate = await api(`/api/v1/companies/${companyId}/stations`, {
    method: 'POST',
    body: {
      name: `E2E Sched ${Date.now()}`,
      timezone: 'Asia/Manila',
      broadcast_start_hour: 6,
      broadcast_end_hour: 8,
      active_days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    },
  });
  assert(stCreate.status === 201 || stCreate.status === 200, 'create disposable station', stCreate);
  const station = stCreate.data;

  setStep(2, 'rotation rules read + write');
  const rulesGet = await api(`/api/v1/stations/${station.id}/rotation-rules`);
  assert(rulesGet.status === 200, 'GET rotation-rules returns 200', rulesGet);
  assert(!!rulesGet.data?.rules, 'rotation-rules returns a rules object', rulesGet.data);
  const rulesPut = await api(`/api/v1/stations/${station.id}/rotation-rules`, {
    method: 'PUT',
    body: { rules: { ...rulesGet.data.rules, artist_separation_minutes: 0, max_plays_per_day: 24 } },
  });
  assert(rulesPut.status === 200, 'PUT rotation-rules returns 200', rulesPut);

  setStep(3, 'station scheduler config read');
  const cfg = await api(`/api/v1/stations/${station.id}/config`);
  assert(cfg.status === 200, 'GET /stations/:id/config returns 200', cfg);

  setStep(4, 'seed library: category + songs');
  const catRes = await api(`/api/v1/stations/${station.id}/categories`, {
    method: 'POST',
    body: { code: `SCH${Date.now() % 100000}`, label: 'E2E Scheduler Cat', rotation_weight: 1 },
  });
  assert(catRes.status === 201, 'create category', catRes);
  const category = catRes.data;
  const allHours = Array.from({ length: 24 }, (_, h) => h);
  for (let i = 0; i < 12; i++) {
    const s = await api(`/api/v1/stations/${station.id}/songs`, {
      method: 'POST',
      body: {
        category_id: category.id,
        title: `E2E Track ${i + 1}`,
        artist: `E2E Artist ${i + 1}`,
        duration_sec: 180 + i * 5,
        eligible_hours: allHours,
      },
    });
    assert(s.status === 201, `create song ${i + 1}/12`, s);
  }

  setStep(5, 'template with slots for broadcast hours');
  const tplRes = await api(`/api/v1/stations/${station.id}/templates`, {
    method: 'POST',
    body: { name: 'E2E Sched Template', type: '1_day', is_default: true },
  });
  assert(tplRes.status === 201, 'create template', tplRes);
  const template = tplRes.data;
  const slots = [];
  for (const hour of [6, 7]) {
    for (let position = 1; position <= 3; position++) {
      slots.push({ hour, position, required_category_id: category.id });
    }
  }
  const slotsPut = await api(`/api/v1/templates/${template.id}/slots`, { method: 'PUT', body: { slots } });
  assert(slotsPut.status === 200, 'set template slots', slotsPut);

  setStep(6, 'generate playlist for a fixed date');
  const genDate = '2026-01-05'; // Monday, in the past month — no collision with "today" flows
  const gen = await api(`/api/v1/stations/${station.id}/playlists/generate`, {
    method: 'POST',
    body: { date: genDate, template_id: template.id },
  });
  assert(gen.status === 200 || gen.status === 201 || gen.status === 202, 'generate accepted', gen);

  setStep(7, 'job reaches a terminal state');
  // The generate response's job_id is a composite key that /jobs/:id (uuid
  // only) rejects — poll the station's job list instead.
  let playlistId = gen.data?.playlist_id ?? null;
  const job = await waitFor(async () => {
    const jr = await api(`/api/v1/stations/${station.id}/jobs`);
    if (jr.status !== 200) return null;
    const jobs = jr.data?.data ?? jr.data ?? [];
    return jobs.find(j => ['completed', 'failed'].includes(j.status)) ?? null;
  }, { timeoutMs: 90_000, label: 'generation job to finish' });
  assert(job.status === 'completed', 'generation job completed successfully', job);
  playlistId = playlistId ?? job.playlist_id ?? null;

  setStep(7.5, 'job detail by uuid');
  const jobGet = await api(`/api/v1/jobs/${job.id}`);
  assert(jobGet.status === 200, 'GET /jobs/:id returns 200 for the real job uuid', jobGet);

  setStep(8, 'playlist exists for the month');
  const month = genDate.slice(0, 7);
  const monthList = await waitFor(async () => {
    const res = await api(`/api/v1/stations/${station.id}/playlists?month=${month}`);
    if (res.status !== 200) return null;
    const items = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
    return items.length > 0 ? items : null;
  }, { timeoutMs: 30_000, label: 'generated playlist to appear in month list' });
  const playlist = monthList.find(p => (p.date ?? '').startsWith(genDate)) ?? monthList[0];
  playlistId = playlistId ?? playlist.id;
  assert(!!playlistId, 'have a playlist id', monthList);

  setStep(9, 'playlist detail has entries');
  const detail = await api(`/api/v1/playlists/${playlistId}`);
  assert(detail.status === 200, 'GET /playlists/:id returns 200', detail);
  const entries = detail.data?.entries ?? detail.data?.slots ?? [];
  assert(entries.length > 0, `playlist has generated entries (${entries.length})`, detail.data?.status);

  setStep(10, 'playlist notes');
  const notes = await api(`/api/v1/playlists/${playlistId}/notes`, {
    method: 'PUT',
    body: { notes: 'E2E reviewed' },
  });
  assert(notes.status === 200, 'PUT playlist notes returns 200', notes);

  setStep(11, 'approve playlist');
  const approve = await api(`/api/v1/playlists/${playlistId}/approve`, { method: 'POST', body: {} });
  assert(approve.status >= 200 && approve.status < 300, 'POST approve succeeds', approve);

  setStep(12, 'export CSV + XLSX');
  const csv = await api(`/api/v1/playlists/${playlistId}/export/csv`, { raw: true });
  assert(csv.status === 200 && csv.bytes > 0, `CSV export returns bytes (${csv.bytes})`, csv.status);
  const xlsx = await api(`/api/v1/playlists/${playlistId}/export/xlsx`, { raw: true });
  assert(xlsx.status === 200 && xlsx.bytes > 0, `XLSX export returns bytes (${xlsx.bytes})`, xlsx.status);

  setStep(13, 'generation failures + jobs listings');
  const failures = await api(`/api/v1/stations/${station.id}/generation-failures`);
  assert(failures.status === 200, 'GET generation-failures returns 200', failures);
  const jobs = await api(`/api/v1/stations/${station.id}/jobs`);
  assert(jobs.status === 200, 'GET station jobs returns 200', jobs);

  setStep(14, 'cleanup: delete station');
  // There is no DELETE /playlists/:id route — playlists live until their
  // station goes away.
  const delSt = await api(`/api/v1/stations/${station.id}`, { method: 'DELETE' });
  assert(delSt.status === 204 || delSt.status === 200, 'DELETE station succeeds', delSt);

  finish('scheduler');
}

main().catch(err => { console.error('\n✗ FAIL [scheduler] unhandled error'); console.error(err); process.exit(1); });
