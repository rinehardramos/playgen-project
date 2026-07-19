#!/usr/bin/env node
/**
 * E2E: company & station management — station CRUD, station settings,
 * company read, system logs, public stations.
 */
import { createRunner, finish } from './lib.mjs';

const r = createRunner('stations');
const { assert, api, setStep } = r;

async function main() {
  setStep(1, 'login');
  const { companyId } = await r.login();

  setStep(2, 'company read');
  const company = await api(`/api/v1/companies/${companyId}`);
  assert(company.status === 200, 'GET /companies/:id returns 200', company);
  assert(company.data?.id === companyId, 'company id matches token');

  setStep(3, 'create station');
  const name = `E2E Stations Journey ${Date.now()}`;
  const created = await api(`/api/v1/companies/${companyId}/stations`, {
    method: 'POST',
    body: {
      name,
      timezone: 'Asia/Manila',
      broadcast_start_hour: 5,
      broadcast_end_hour: 23,
      active_days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    },
  });
  assert(created.status === 201 || created.status === 200, 'POST station returns 2xx', created);
  const station = created.data;
  assert(!!station?.id, 'created station has an id');

  setStep(4, 'station appears in company list');
  const list = await api(`/api/v1/companies/${companyId}/stations`);
  assert(list.status === 200, 'list stations returns 200', list);
  assert(list.data.some(s => s.id === station.id), 'new station is in the list');

  setStep(5, 'read station');
  const got = await api(`/api/v1/stations/${station.id}`);
  assert(got.status === 200, 'GET /stations/:id returns 200', got);
  assert(got.data?.name === name, 'station round-trips its name');

  setStep(6, 'update station');
  const put = await api(`/api/v1/stations/${station.id}`, {
    method: 'PUT',
    body: { name: `${name} (edited)`, broadcast_start_hour: 6 },
  });
  assert(put.status === 200, 'PUT /stations/:id returns 200', put);
  assert(put.data?.name?.endsWith('(edited)'), 'update persists the name');

  setStep(7, 'station settings upsert + read');
  const putSetting = await api(`/api/v1/stations/${station.id}/settings/e2e_probe`, {
    method: 'PUT',
    body: { value: 'hello-e2e' },
  });
  assert(putSetting.status >= 200 && putSetting.status < 300, 'PUT station setting succeeds', putSetting);
  const settings = await api(`/api/v1/stations/${station.id}/settings`);
  assert(settings.status === 200, 'GET station settings returns 200', settings);
  const settingsBlob = JSON.stringify(settings.data);
  assert(settingsBlob.includes('e2e_probe'), 'setting key round-trips', settings.data);

  setStep(8, 'station settings delete');
  const delSetting = await api(`/api/v1/stations/${station.id}/settings/e2e_probe`, { method: 'DELETE' });
  assert(delSetting.status >= 200 && delSetting.status < 300, 'DELETE station setting succeeds', delSetting);

  setStep(9, 'system logs endpoint');
  const logs = await api(`/api/v1/companies/${companyId}/logs`);
  assert(logs.status === 200, 'GET /companies/:id/logs returns 200', logs);
  assert(Array.isArray(logs.data) || Array.isArray(logs.data?.logs ?? logs.data?.data), 'logs response is list-shaped', logs.data);

  setStep(10, 'public stations listing');
  const pub = await api('/api/v1/public/stations', { auth: false });
  assert(pub.status === 200, 'GET /public/stations returns 200 without auth', pub);

  setStep(11, 'delete station');
  const del = await api(`/api/v1/stations/${station.id}`, { method: 'DELETE' });
  assert(del.status === 204 || del.status === 200, 'DELETE /stations/:id succeeds', del);
  const gone = await api(`/api/v1/stations/${station.id}`);
  assert(gone.status === 404, 'deleted station returns 404', gone);

  finish('stations');
}

main().catch(err => { console.error('\n✗ FAIL [stations] unhandled error'); console.error(err); process.exit(1); });
