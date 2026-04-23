# Active Todo

_Plan and track in-flight work here. Check items off as you complete them. Add a Review section at the bottom when done._

## Pending — OwnRadio HLS Streaming Wires (2026-04-23)

Three wires identified in `docs/superpowers/specs/2026-04-23-ownradio-hls-streaming-design.md` that are not yet implemented:

- [ ] **Wire 1 — Gateway `/stream/*` location block** (`gateway/nginx.conf.template`): Add location block proxying `/stream/` to DJ service port 3007; no auth; `proxy_buffering off`. Without this, browsers cannot reach the HLS playlist endpoint.
- [ ] **Wire 2 — Auto-start playout after manifest publish** (`services/dj/src/services/manifestService.ts`): After `buildProgramManifest` succeeds and `published_at` is set, call `startPlayout(stationId)` → background `generateHls(stationId, manifest)` → `notifyStreamUrlChange(slug, streamUrl)`. Also add `status` field (`idle` | `generating` | `live` | `ended`) to `PlayoutState` in `playoutScheduler.ts`.
- [ ] **Wire 3 — R2-to-local cache constraint documentation and guard** (`services/dj/src/playout/hlsGenerator.ts`): Add pre-flight size check; if total estimated audio exceeds `HLS_MAX_PREFETCH_MB` (env var, default 500), log a warning. Segment-by-segment optimization deferred to a follow-up. Document the limit in service README.

## Pending — Info-Broker Audio Sourcing Callback (2026-04-23)

- [ ] **Implement `POST /api/v1/internal/audio-sourcing/callback` endpoint** (playlist-service or scheduler-service): Receives `{ station_id, results: [{ id, audio_url, audio_source }] }` from info-broker after it has sourced YouTube audio. Writes `audio_url` and `audio_source` to `songs` table rows. Validate that `station_id` matches the songs' station (tenant isolation). Authenticate using shared secret (`INFO_BROKER_CALLBACK_SECRET` env var). Add integration test: happy path, mismatched station (403), missing song id (404).

---

## Review — AI DJ Service Phase 1 (archived 2026-04-07)
Phase 1 MVP complete: migrations 016–023, shared DJ types, dj-service scaffold, LLM/TTS adapters (OpenRouter + OpenAI/ElevenLabs), prompt builder, profile/daypart/template services + routes, BullMQ script generation pipeline, review flow (approve/reject/edit), Dockerfile, docker-compose + nginx gateway integration, default "Alex" persona seed, and unit tests (config, promptBuilder, openrouter, TTS adapters, generationWorker). Verified and merged.
