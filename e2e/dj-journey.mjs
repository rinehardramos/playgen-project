#!/usr/bin/env node
/**
 * E2E: AI DJ surface — DJ profiles, script templates, adlib clip metadata,
 * listener shoutouts, dayparts, station DJ usage.
 *
 * Script generation / TTS / playout need external LLM + TTS providers, so this
 * journey covers the CRUD surfaces and read models that don't burn API credits.
 */
import { createRunner, finish } from './lib.mjs';

const r = createRunner('dj');
const { assert, api, setStep } = r;

async function main() {
  setStep(1, 'login + station');
  const { companyId } = await r.login();
  const station = await r.ensureStation(companyId);

  setStep(2, 'DJ profiles list');
  const profiles = await api('/api/v1/dj/profiles');
  assert(profiles.status === 200, 'GET /dj/profiles returns 200', profiles);

  setStep(3, 'create DJ profile');
  const profCreate = await api('/api/v1/dj/profiles', {
    method: 'POST',
    body: {
      name: `E2E DJ ${Date.now()}`,
      personality: 'Upbeat morning host, warm and concise.',
      voice_style: 'energetic',
      llm_model: 'anthropic/claude-3.5-haiku',
      llm_temperature: 0.8,
      tts_provider: 'elevenlabs',
      tts_voice_id: 'e2e-voice',
      is_default: false,
      is_active: true,
    },
  });
  assert(profCreate.status === 201 || profCreate.status === 200, 'POST /dj/profiles returns 2xx', profCreate);
  const profile = profCreate.data;
  assert(!!profile?.id, 'profile has an id');

  setStep(4, 'script templates CRUD');
  const tplCreate = await api(`/api/v1/dj/stations/${station.id}/script-templates`, {
    method: 'POST',
    body: {
      name: `E2E Script Template ${Date.now()}`,
      segment_type: 'song_intro',
      prompt_template: 'Coming up next: {{song_title}} by {{artist}}!',
    },
  });
  assert(tplCreate.status === 201 || tplCreate.status === 200, 'POST script template returns 2xx', tplCreate);
  const scriptTpl = tplCreate.data;
  const tplList = await api(`/api/v1/dj/stations/${station.id}/script-templates`);
  assert(tplList.status === 200, 'GET script templates returns 200', tplList);
  if (scriptTpl?.id) {
    const tplPut = await api(`/api/v1/dj/stations/${station.id}/script-templates/${scriptTpl.id}`, {
      method: 'PATCH',
      body: { prompt_template: 'Next up: {{song_title}} — {{artist}}.' },
    });
    assert(tplPut.status === 200, 'PATCH script template returns 200', tplPut);
    const tplDel = await api(`/api/v1/dj/stations/${station.id}/script-templates/${scriptTpl.id}`, { method: 'DELETE' });
    assert(tplDel.status === 204 || tplDel.status === 200, 'DELETE script template succeeds', tplDel);
  }

  setStep(5, 'listener shoutouts create + list + delete');
  const shoutCreate = await api('/api/v1/dj/shoutouts', {
    method: 'POST',
    body: {
      station_id: station.id,
      listener_name: 'E2E Listener',
      message: 'Shoutout to the e2e suite keeping the station honest!',
      platform: 'web',
    },
  });
  assert(shoutCreate.status === 201 || shoutCreate.status === 200, 'POST shoutout returns 2xx', shoutCreate);
  const shoutList = await api(`/api/v1/dj/shoutouts?station_id=${station.id}`);
  assert(shoutList.status === 200, 'GET shoutouts returns 200', shoutList);
  const mine = (Array.isArray(shoutList.data) ? shoutList.data : []).find(s => s.listener_name === 'E2E Listener');
  assert(!!mine, 'created shoutout is listed as pending', shoutList.data);
  const shoutDel = await api(`/api/v1/dj/shoutouts/${mine.id}`, { method: 'DELETE' });
  assert(shoutDel.status === 204 || shoutDel.status === 200, 'DELETE shoutout succeeds', shoutDel);

  setStep(6, 'adlib clips list');
  const adlibs = await api(`/api/v1/dj/adlib-clips?station_id=${station.id}`);
  assert(adlibs.status === 200, 'GET adlib clips returns 200', adlibs);

  setStep(7, 'station DJ usage');
  const usage = await api(`/api/v1/stations/${station.id}/dj/usage`);
  assert(usage.status === 200, 'GET station dj usage returns 200', usage);

  setStep(8, 'social auth status');
  const social = await api(`/api/v1/dj/social/status?station_id=${station.id}`);
  assert(social.status === 200, 'GET /dj/social/status returns 200', social);

  setStep(9, 'podcast episode intake (imported script, two hosts)');
  const hosts = [
    { name: 'Alex', provider: 'mistral', voice_id: 'en_paul_cheerful' },
    { name: 'Sam', provider: 'elevenlabs', voice_id: 'e2e-cloned-voice' },
  ];
  const badHosts = await api('/api/v1/dj/podcasts', {
    method: 'POST',
    body: { station_id: station.id, title: 'E2E Pod', hosts: [hosts[0]], script_text: '[Alex] hi' },
  });
  assert(badHosts.status === 400, 'single-host request is rejected', badHosts);
  const podCreate = await api('/api/v1/dj/podcasts', {
    method: 'POST',
    body: {
      station_id: station.id,
      title: `E2E Podcast ${Date.now()}`,
      hosts,
      script_text: '[Alex] Welcome to the show!\n[Sam] Great to be here.',
    },
  });
  assert(podCreate.status === 202, 'POST /dj/podcasts returns 202', podCreate);
  const episode = podCreate.data;
  assert(episode?.source === 'imported', 'episode is marked imported');
  assert(Array.isArray(episode?.hosts) && episode.hosts.length === 2, 'episode persists both hosts');
  assert(!JSON.stringify(episode.hosts).includes('api_key'), 'api keys are never persisted');

  setStep(10, 'podcast list + detail + delete');
  const podList = await api(`/api/v1/dj/podcasts?station_id=${station.id}`);
  assert(podList.status === 200, 'GET /dj/podcasts returns 200', podList);
  assert(podList.data.some(p => p.id === episode.id), 'episode is listed');
  const podGet = await api(`/api/v1/dj/podcasts/${episode.id}`);
  assert(podGet.status === 200, 'GET /dj/podcasts/:id returns 200', podGet);
  assert(['pending', 'rendering', 'ready', 'failed'].includes(podGet.data?.status), 'episode has a lifecycle status', podGet.data);
  assert('ownradio_status' in (podGet.data ?? {}), 'episode carries an ownradio_status field', podGet.data);

  setStep(11, 'manual OwnRadio publish is guarded');
  const pub = await api(`/api/v1/dj/podcasts/${episode.id}/publish-ownradio`, { method: 'POST', body: {} });
  assert(pub.status === 200, 'POST publish-ownradio returns 200', pub);
  assert(['published', 'skipped', 'failed'].includes(pub.data?.status), 'publish returns an outcome', pub.data);
  // Un-rendered/local-audio episodes must never be pushed silently
  assert(pub.data.status !== 'published' || podGet.data?.status === 'ready', 'only ready episodes can publish');

  const podDel = await api(`/api/v1/dj/podcasts/${episode.id}`, { method: 'DELETE' });
  assert(podDel.status === 204, 'DELETE /dj/podcasts/:id returns 204', podDel);

  finish('dj');
}

main().catch(err => { console.error('\n✗ FAIL [dj] unhandled error'); console.error(err); process.exit(1); });
