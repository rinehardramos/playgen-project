# End-to-end journeys

Zero-dependency Node scripts that drive the live stack through the gateway,
in the same style as `programs-journey.mjs`. No Playwright, no install — just
`node` and a running `docker compose up`.

## Running

```bash
docker compose up --build -d          # gateway on :8888 (docker-compose.override.yml)
BASE_URL=http://localhost:8888 pnpm run test:e2e          # all journeys
BASE_URL=http://localhost:8888 pnpm run test:e2e:library  # one journey
BASE_URL=http://localhost:8888 node e2e/run-all.mjs auth dj  # a subset
```

Env: `BASE_URL` (default `http://localhost`), `E2E_EMAIL` / `E2E_PASSWORD`
(default seeded admin `admin@playgen.local` / `changeme`).

`run-all.mjs` logs in once and shares the token via `E2E_TOKEN` because
`POST /auth/login` is rate-limited to 5/minute — bear that in mind when
running journeys back-to-back by hand (the auth journey always performs a
real login).

## Journeys

| Journey | Covers |
|---|---|
| `auth` | login, bad credentials, /me, 401s, refresh + rotation, forgot-password, logout revocation |
| `stations` | station CRUD, station settings, company read, system logs, public stations |
| `users-roles` | profile update, company users, roles list, custom-role subscription gate, invites, cleanup |
| `library` | categories CRUD + delete guard, songs CRUD (soft delete), hour templates + slots + clone |
| `programs` | (pre-existing) programs, show clocks, episodes, coverage-gap stub |
| `scheduler-playlist` | rotation rules, config, full generation pipeline (seed library → template → generate → job poll), playlist detail/notes/approve, CSV/XLSX export |
| `analytics` | dashboard stats, heatmap, over/underplayed, category distribution, song history, auth guard |
| `dj` | DJ profiles, script templates CRUD, shoutouts, adlib clips, station usage, social status |

Each journey cleans up what it creates where the API allows it; journeys that
need heavy fixtures (scheduler) build a disposable station and delete it.
