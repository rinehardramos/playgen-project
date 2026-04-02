# PlayGen — Testing Strategy

## Overview

Three test layers, following the testing pyramid:

```
         /\
        /E2E\          Playwright — critical user journeys
       /------\
      /  Integ  \      Supertest — REST API contracts
     /------------\
    /     Unit      \  Vitest — pure logic (algorithm, parsers, validators)
   /------------------\
```

**Coverage targets**:
| Layer | Target | Measured by |
|---|---|---|
| Unit | 90%+ for scheduler-service core | Vitest coverage |
| Integration | All REST endpoints | Supertest |
| E2E | 5 critical paths | Playwright |

---

## Unit Tests

**Tool**: Vitest

Run: `npm run test:unit` per service

### scheduler-service — Rotation Algorithm

These are the most critical tests. The algorithm must be deterministic and rule-correct.

```
tests/unit/scheduler/
  rotationAlgorithm.test.ts
  eligibilityFilter.test.ts
  artistSeparation.test.ts
  leastRecentlyPlayed.test.ts
  manualOverridePreservation.test.ts
```

**Key scenarios**:
- Given a slot requiring category `FGs` at hour 4, returns an eligible song
- Given `min_gap_hours: 3`, does not replay a song played 2 hours ago
- Given `max_same_artist_per_hour: 1`, does not assign same artist twice in the same hour
- Given `artist_separation_slots: 4`, enforces minimum gap between same artist
- Given all eligible songs are exhausted (all played today), falls back gracefully (log warning, pick least-penalized)
- Manual override entries are preserved when `regenerate()` is called
- Algorithm is deterministic: same seed → same output

### library-service — XLSM Import Parser

```
tests/unit/library/
  parseMaterialString.test.ts
  parseTemplateSheet.test.ts
  parseLoadSheet.test.ts
```

**Key scenarios for `parseMaterialString()`**:
- `"FGsA     A Man Without Love - Engelbert Humperdinck {FGsA_4-FGsA_5-FGsA_6-}"` →
  `{ title: "A Man Without Love", artist: "Engelbert Humperdinck", category: "FGsA", eligibleHours: [4, 5, 6] }`
- Handles songs with no eligible slot tokens
- Handles artists with hyphens in their name (e.g., "Peter & Gordon - ...", "Everly Brothers")
- Handles duration annotations like `(2:54min)` in material string
- Handles multi-subtype codes like `{FGsA_4-FGsB_5-}`

### auth-service

```
tests/unit/auth/
  jwtGenerate.test.ts
  jwtVerify.test.ts
  passwordHash.test.ts
```

---

## Integration Tests

**Tool**: Supertest + real PostgreSQL (test DB, not mocked)

Run: `npm run test:integration` per service

> **Important**: Never mock the database for integration tests. Tests must run against a real PostgreSQL instance (see `LESSONS.md` L-XXX). Use a dedicated test database, reset between test suites with transactions or truncation.

### Setup
```typescript
// shared/test/setup.ts
beforeAll(() => startTestDatabase())
afterEach(() => rollbackTransaction())  // or truncate tables
afterAll(() => stopTestDatabase())
```

### auth-service integration
```
tests/integration/auth/
  login.test.ts             — valid credentials, wrong password, inactive user
  refresh.test.ts           — valid refresh, expired refresh, replayed refresh (rotation)
  logout.test.ts            — revokes token, re-use fails
  permissions.test.ts       — each role cannot access endpoints above its level
```

### library-service integration
```
tests/integration/library/
  categories.test.ts        — CRUD, station isolation (station A cannot see station B's categories)
  songs.test.ts             — CRUD, pagination, search, active filter
  import.test.ts            — upload PlayGen Encoder2.2.xlsm, verify all songs imported
```

**Critical isolation test** (multi-tenancy):
```typescript
it('station A cannot read station B songs', async () => {
  const tokenA = await loginAs(userFromStationA)
  const res = await request(app)
    .get(`/api/v1/stations/${stationB.id}/songs`)
    .set('Authorization', `Bearer ${tokenA}`)
  expect(res.status).toBe(403)
})
```

### scheduler-service integration
```
tests/integration/scheduler/
  templates.test.ts         — CRUD, slot definitions
  generatePlaylist.test.ts  — trigger generation, poll job, verify playlist created
  cronConfig.test.ts        — enable/disable cron, config update
  rotationRules.test.ts     — get/update rules
```

### playlist-service integration
```
tests/integration/playlist/
  listPlaylists.test.ts     — date range filter, status filter
  getPlaylist.test.ts       — entries shape, manual override flag
  manualOverride.test.ts    — override slot, re-generate preserves override
  approve.test.ts           — approval flow, permission check
  export.test.ts            — XLSX export returns valid file, CSV export
```

### analytics-service integration
```
tests/integration/analytics/
  rotationReport.test.ts    — returns correct play counts for date range
  overplayed.test.ts        — flags songs above threshold
  underplayed.test.ts       — flags songs below threshold
```

---

## End-to-End Tests

**Tool**: Playwright (browser automation against running frontend)

Run: `npm run test:e2e`

### E2E Critical Paths

**E2E-001: Full playlist generation workflow**
1. Login as `scheduler`
2. Navigate to Generate Playlist
3. Select date (tomorrow) and default template
4. Click Generate
5. Wait for status to change to "ready"
6. Verify playlist has 96 entries (24 hours × 4 positions)
7. Export as XLSX — verify download triggered

**E2E-002: Manual override preserved on re-generate**
1. Login as `scheduler`
2. Open an existing playlist
3. Click slot at Hour 4, Position 1 → swap song
4. Verify slot shows override flag
5. Click "Re-generate" (non-override slots)
6. Verify Hour 4 Position 1 still has the manually-selected song

**E2E-003: Station isolation**
1. Login as `station_admin` of Station A
2. Attempt to navigate to Station B's playlist via direct URL
3. Verify 403 or redirect to own station

**E2E-004: Role-based access**
1. Login as `viewer`
2. Verify Generate button is not visible
3. Verify playlist entries are read-only
4. Verify Library and Template management are not accessible

**E2E-005: Song import from XLSX**
1. Login as `station_admin`
2. Navigate to Song Library → Import
3. Upload `PlayGen Encoder2.2.xlsm`
4. Verify import summary shows correct song count
5. Verify songs appear in library filtered by category

---

## Test Data & Fixtures

```
shared/test/fixtures/
  companies.ts         — 2 test companies (Company A, Company B)
  stations.ts          — 2 stations per company
  users.ts             — one user per role per company
  categories.ts        — sample categories (FGs, FGf, 7, 8, PGs)
  songs.ts             — 20 songs per category with slot definitions
  templates.ts         — 1-day template with full 24-hour slot grid
  rotationRules.ts     — default rules + strict rules variant
```

---

## Running Tests

```bash
# Unit tests for a specific service
cd services/scheduler && npm run test:unit

# Integration tests (requires Docker DB)
docker-compose -f docker-compose.test.yml up -d db
npm run test:integration

# E2E tests (requires full stack running)
docker-compose up -d
npm run test:e2e

# All tests (CI)
npm run test:all
```

---

## CI Requirements

All PRs must pass:
- [ ] Unit tests (all services)
- [ ] Integration tests (all services)
- [ ] TypeScript compilation (`tsc --noEmit`)
- [ ] Lint (`eslint`)

E2E tests run nightly on `main`, not on every PR (too slow).
