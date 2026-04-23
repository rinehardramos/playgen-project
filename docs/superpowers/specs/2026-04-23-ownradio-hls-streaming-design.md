# OwnRadio HLS Streaming via PlayGen R2 — Design Spec
**Date:** 2026-04-23  
**Status:** Approved  
**Scope:** Wire the existing HLS playout infrastructure in the PlayGen DJ service to ownradio.net

---

## Problem

PlayGen's DJ service already has a complete HLS playout stack (`hlsGenerator.ts`, `playoutScheduler.ts`, `streamRoutes.ts`) and ownradio already has a WebSocket-driven audio player that supports HLS. The two are not connected. Three specific wires are missing.

---

## Architecture

```
PlayGen DJ Service
  ├── playoutScheduler   — in-memory playout state, segment advance timer
  ├── hlsGenerator       — ffmpeg: R2 audio → local .ts segments + .m3u8
  └── streamRoutes       — serves GET /stream/:stationId/playlist.m3u8
           │
           │  (nginx gateway exposes /stream/* to public internet)
           ▼
PlayGen Station Service
  └── streamControlNotifier — POST ownradio webhook with new stream URL
           │
           ▼
OwnRadio API
  └── webhooks.ts — relays stream_control event via Socket.IO
           │
           ▼
OwnRadio Web (browser)
  └── useStation hook → AudioControls (HLS.js) → plays playlist.m3u8
```

---

## The Three Missing Wires

### Wire 1 — Gateway: expose `/stream/*` publicly

**File:** `gateway/nginx.conf.template`

Add a new location block that proxies `/stream/` to the DJ service. The DJ service runs on port `3007`.

```nginx
# ─── DJ: public HLS stream ───────────────────────────────────
location ~ ^/stream/ {
    set $svc http://${DJ_HOST}:3007;
    proxy_pass $svc;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Request-ID $request_id;
    # HLS requires no buffering for live-style playlists
    proxy_buffering off;
}
```

No auth — these are public streaming endpoints consumed by browsers.

---

### Wire 2 — Playout trigger: auto-start after manifest is published

**When:** After a DJ show manifest is built and marked `ready` (i.e., after `buildProgramManifest` succeeds and the episode is published).

**Where:** `services/dj/src/services/manifestService.ts` — at the end of the publish flow, call `startPlayout(stationId)` then notify ownradio.

**Flow:**
1. `buildProgramManifest(episode_id)` completes → manifest stored in R2, episode `published_at` set
2. Call `startPlayout(stationId)` → loads manifest, begins advance timer
3. Call `generateHls(stationId, manifest)` → ffmpeg downloads R2 audio to local cache, produces `.m3u8` + `.ts` segments
4. Retrieve station `slug` from DB
5. Call `notifyStreamUrlChange(slug, streamUrl)` where `streamUrl = https://api.playgen.site/stream/{stationId}/playlist.m3u8`

Step 3 (ffmpeg transcode) is the slow step — can take 30–120s for a full show. This should run in the background (non-blocking), with the playout considered "pending" until HLS is ready.

**State machine for playout status:**
- `idle` — no playout active
- `generating` — ffmpeg running, stream not yet available
- `live` — `.m3u8` is ready, ownradio notified
- `ended` — manifest exhausted, cleanup triggered

`playoutScheduler.ts` needs a `status` field added to `PlayoutState`.

---

### Wire 3 — R2 audio resolution for ffmpeg

**Current behavior:** `hlsGenerator.resolveAudioPath()` downloads each R2 segment to a local `.cache` directory via `storage.read()` before passing the path to ffmpeg's concat list.

**Issue:** With R2 as the storage backend, this means all audio for the entire show must be downloaded to the DJ service container's local disk before ffmpeg starts. For a full-day show (many hours of audio) this could be gigabytes.

**Fix:** Keep the existing approach but add a pre-flight size check. If the total estimated audio size exceeds `HLS_MAX_PREFETCH_MB` (env var, default `500`), log a warning and proceed segment-by-segment rather than all-at-once. For the initial implementation (sample shows, not full-day), the existing approach is sufficient — document the limit and leave the optimization for a follow-up.

No code change needed for Wire 3 in the initial implementation. Document it as a known constraint.

---

## Data Flow: Full End-to-End

1. DJ show approved in PlayGen UI → `buildProgramManifest` called
2. Manifest JSON written to R2 (`manifests/{episode_id}.json`)
3. `startPlayout(stationId)` called → state = `generating`
4. ffmpeg reads manifest, downloads audio segments from R2 to local cache, produces HLS
5. HLS ready → state = `live`
6. `notifyStreamUrlChange(slug, "https://api.playgen.site/stream/{stationId}/playlist.m3u8")` called
7. PlayGen station service POSTs to `https://ownradio.net/webhooks/stations/{slug}/stream-control`
8. OwnRadio API receives webhook → `socket.emit("stream_control", { action: "url_change", streamUrl })`
9. OwnRadio browser receives event → `useStation` updates `streamUrl`
10. `AudioControls` reinitialises HLS.js with new URL → begins playback

---

## Environment Variables Required

### PlayGen DJ service (Railway)
| Variable | Value |
|---|---|
| `HLS_OUTPUT_PATH` | `/app/data/hls` (persistent volume or tmpfs) |
| `HLS_MAX_PREFETCH_MB` | `500` |

### PlayGen Station service (Railway)
| Variable | Value |
|---|---|
| `OWNRADIO_WEBHOOK_URL` | `https://ownradio.net` (already defined, verify it's set) |
| `PLAYGEN_WEBHOOK_SECRET` | shared secret matching ownradio's env |

### OwnRadio API (Railway/Vercel)
| Variable | Value |
|---|---|
| `PLAYGEN_WEBHOOK_SECRET` | shared secret matching PlayGen's env |

---

## Files to Change

| File | Change |
|---|---|
| `gateway/nginx.conf.template` | Add `/stream/` location block (Wire 1) |
| `services/dj/src/playout/playoutScheduler.ts` | Add `status` field to `PlayoutState` |
| `services/dj/src/services/manifestService.ts` | Trigger playout + HLS generation + webhook after publish (Wire 2) |
| `services/dj/src/playout/hlsGenerator.ts` | No change needed for initial impl |
| `services/station/src/services/streamControlNotifier.ts` | No change needed |

---

## Testing

1. **Unit:** Mock `startPlayout`, `generateHls`, `notifyStreamUrlChange` — verify they are called with correct args after `buildProgramManifest` completes.
2. **Integration (local docker-compose):** Trigger manifest build → poll `GET /stream/{stationId}/playlist.m3u8` until 200 → verify `.m3u8` contains valid segment references.
3. **E2E (manual):** Open ownradio station page → approve a DJ show in PlayGen → verify browser audio player switches to the HLS stream.

---

## Known Constraints

- **HLS generation is blocking per station:** Only one ffmpeg process per station at a time (enforced by `activePlayouts` map). Concurrent shows on the same station are not supported.
- **Local disk required:** HLS segments live on the DJ service container's local filesystem. If the container restarts, active streams are lost. A future iteration could write `.ts` segments directly to R2 and serve them from there.
- **R2 download latency:** For a large show, all audio must be fetched from R2 before playback starts. Mitigation: only run this for approved, sample-length shows until the segment-by-segment optimization is built.
- **No DVR/time-shift:** Listeners who join mid-stream get the live window. Past segments are not seekable.
