#!/usr/bin/env node
/**
 * E2E: song library — categories CRUD, songs CRUD, hour templates
 * (CRUD + slots + clone), category-with-songs delete guard.
 */
import { createRunner, finish } from './lib.mjs';

const r = createRunner('library');
const { assert, api, setStep } = r;

async function main() {
  setStep(1, 'login + station');
  const { companyId } = await r.login();
  const station = await r.ensureStation(companyId);

  setStep(2, 'create category');
  const catCode = `E2E${Date.now() % 100000}`;
  const catCreate = await api(`/api/v1/stations/${station.id}/categories`, {
    method: 'POST',
    body: { code: catCode, label: 'E2E Test Category', rotation_weight: 1, color_tag: '#0ea5e9' },
  });
  assert(catCreate.status === 201, 'POST category returns 201', catCreate);
  const category = catCreate.data;
  assert(!!category?.id, 'category has an id');

  setStep(3, 'category list contains it');
  const catList = await api(`/api/v1/stations/${station.id}/categories`);
  assert(catList.status === 200, 'GET categories returns 200', catList);
  assert(catList.data.some(c => c.id === category.id), 'new category is listed');

  setStep(4, 'update category');
  const catPut = await api(`/api/v1/categories/${category.id}`, {
    method: 'PUT',
    body: { label: 'E2E Test Category (edited)' },
  });
  assert(catPut.status === 200, 'PUT category returns 200', catPut);
  assert(catPut.data?.label?.endsWith('(edited)'), 'category update persists');

  setStep(5, 'create song');
  const songCreate = await api(`/api/v1/stations/${station.id}/songs`, {
    method: 'POST',
    body: {
      category_id: category.id,
      title: `E2E Song ${Date.now()}`,
      artist: 'The E2E Band',
      duration_sec: 215,
      eligible_hours: [6, 7, 8, 9, 10],
    },
  });
  assert(songCreate.status === 201, 'POST song returns 201', songCreate);
  const song = songCreate.data;
  assert(!!song?.id, 'song has an id');

  setStep(6, 'song list + read + update');
  const songList = await api(`/api/v1/stations/${station.id}/songs`);
  assert(songList.status === 200, 'GET station songs returns 200', songList);
  const listedSongs = Array.isArray(songList.data) ? songList.data : songList.data?.data ?? [];
  assert(listedSongs.some(s => s.id === song.id), 'new song is listed', songList.data);
  const songGet = await api(`/api/v1/songs/${song.id}`);
  assert(songGet.status === 200, 'GET /songs/:id returns 200', songGet);
  const songPut = await api(`/api/v1/songs/${song.id}`, {
    method: 'PUT',
    body: { artist: 'The E2E Band (Remastered)' },
  });
  assert(songPut.status === 200, 'PUT /songs/:id returns 200', songPut);
  assert(songPut.data?.artist?.includes('Remastered'), 'song update persists');

  setStep(7, 'category with active songs refuses delete');
  const catDelBlocked = await api(`/api/v1/categories/${category.id}`, { method: 'DELETE' });
  assert(catDelBlocked.status === 409, 'DELETE category with songs returns 409', catDelBlocked);

  setStep(8, 'create hour template');
  const tplCreate = await api(`/api/v1/stations/${station.id}/templates`, {
    method: 'POST',
    body: { name: `E2E Template ${Date.now()}`, type: '1_day' },
  });
  assert(tplCreate.status === 201, 'POST template returns 201', tplCreate);
  const template = tplCreate.data;
  assert(!!template?.id, 'template has an id');

  setStep(9, 'bulk-set template slots');
  const slots = [
    { hour: 6, position: 1, required_category_id: category.id },
    { hour: 6, position: 2, required_category_id: category.id },
    { hour: 7, position: 1, required_category_id: category.id },
  ];
  const slotsPut = await api(`/api/v1/templates/${template.id}/slots`, { method: 'PUT', body: { slots } });
  assert(slotsPut.status === 200, 'PUT template slots returns 200', slotsPut);
  const tplGet = await api(`/api/v1/templates/${template.id}`);
  assert(tplGet.status === 200, 'GET template returns 200', tplGet);
  const tplSlots = tplGet.data?.slots ?? [];
  assert(tplSlots.length === 3, 'template round-trips 3 slots', tplGet.data);

  setStep(10, 'single slot upsert + delete');
  const slotPut = await api(`/api/v1/templates/${template.id}/slots/8/1`, {
    method: 'PUT',
    body: { required_category_id: category.id },
  });
  assert(slotPut.status >= 200 && slotPut.status < 300, 'PUT single slot succeeds', slotPut);
  const slotDel = await api(`/api/v1/templates/${template.id}/slots/8/1`, { method: 'DELETE' });
  assert(slotDel.status >= 200 && slotDel.status < 300, 'DELETE single slot succeeds', slotDel);

  setStep(11, 'clone template');
  const clone = await api(`/api/v1/templates/${template.id}/clone`, {
    method: 'POST',
    body: { target_station_id: station.id },
  });
  assert(clone.status === 201, 'POST template clone returns 201', clone);
  assert(!!clone.data?.id && clone.data.id !== template.id, 'clone is a new template');

  setStep(12, 'template update + list');
  const tplPut = await api(`/api/v1/templates/${template.id}`, {
    method: 'PUT',
    body: { name: 'E2E Template (edited)' },
  });
  assert(tplPut.status === 200, 'PUT template returns 200', tplPut);
  const tplList = await api(`/api/v1/stations/${station.id}/templates`);
  assert(tplList.status === 200, 'GET station templates returns 200', tplList);
  assert(tplList.data.some(t => t.id === template.id), 'template is listed');

  setStep(13, 'cleanup: delete clone, template, song, category');
  const cloneDel = await api(`/api/v1/templates/${clone.data.id}`, { method: 'DELETE' });
  assert(cloneDel.status === 204, 'DELETE clone returns 204', cloneDel);
  const tplDel = await api(`/api/v1/templates/${template.id}`, { method: 'DELETE' });
  assert(tplDel.status === 204, 'DELETE template returns 204', tplDel);
  const songDel = await api(`/api/v1/songs/${song.id}`, { method: 'DELETE' });
  assert(songDel.status === 204 || songDel.status === 200, 'DELETE song succeeds', songDel);
  // Song deletion is soft (row keeps its category FK), so hard-deleting the
  // category is impossible — deactivate it instead.
  const catOff = await api(`/api/v1/categories/${category.id}`, {
    method: 'PUT',
    body: { is_active: false },
  });
  assert(catOff.status === 200, 'deactivate category returns 200', catOff);

  finish('library');
}

main().catch(err => { console.error('\n✗ FAIL [library] unhandled error'); console.error(err); process.exit(1); });
