# PlayGen — Lessons Learned

A living log of non-obvious discoveries, gotchas, and decisions made during development. Check this before starting a new feature — your problem may already be solved.

Format per entry:
- **Date**: when this was discovered
- **Context**: what we were doing
- **Problem**: what went wrong or what was unclear
- **Resolution**: what we did about it
- **Applies to**: which part of the system this affects

---

## Analysis & Migration

### L-001 — Excel VBA macros are not readable via pandas
**Date**: 2026-04-02
**Context**: Analyzing PlayGen Encoder2.2.xlsm to reverse-engineer scheduling logic
**Problem**: `pandas.read_excel()` reads cell values only — VBA macro code is not accessible this way. The `.xlsm` format stores macros in a binary OLE container that pandas does not parse. We could only infer macro behavior from the data structures left behind (template grids, slot encoding, LOAD matrix).
**Resolution**: Reconstructed the scheduling algorithm by analyzing: (1) the song-to-slot encoding format `{FGsA_4-FGsA_5-}`, (2) the template grid structure (rows=songs, cols=hour×position), (3) the LOAD sheet's accumulation pattern. The inferred algorithm (least-recently-played + eligibility filter) is documented in `docs/migration-plan.md`.
**Applies to**: scheduler-service (generation algorithm), any future re-analysis of .xlsm files

### L-002 — Song eligible slots are encoded in the material name string, not separate cells
**Date**: 2026-04-02
**Context**: Parsing the FGs, PGs, 7, 8, 9, c1, etc. category sheets
**Problem**: Song eligibility for time slots is embedded inside the song's display string, not in a dedicated column. Format: `FGsA     A Man Without Love - Engelbert Humperdinck {FGsA_4-FGsA_5-FGsA_6-}`. The `{CategoryCode_Hour-}` tokens define eligible hours.
**Resolution**: Import parser must use a regex to extract eligible hours from the curly-brace token. Pattern: `\{([^}]+)\}` → split by `-` → strip category prefix → keep numeric hour values. Store as `song_slots (song_id, eligible_hour)` rows.
**Applies to**: library-service (XLSM import parser, `parseMaterialString()`)

### L-003 — LOAD sheet is a usage matrix, not a log
**Date**: 2026-04-02
**Context**: Trying to understand the LOAD sheet (3052 rows × 397 columns)
**Problem**: The LOAD sheet does not store individual play events. It is an aggregated matrix: rows are songs (across all categories), columns are time slots × scheduling windows. Values are cumulative play counts. Pandas output was 24MB — the size is due to empty cells being read as NaN across 397 columns.
**Resolution**: For the web app, we replace the matrix with a normalized `play_history` table (one row per play event). This is richer data and supports all the rotation rule queries the algorithm needs. For initial seed data import, we read non-zero values from the LOAD matrix and back-calculate approximate `played_at` timestamps (using relative counts as a proxy).
**Applies to**: analytics-service, library-service (seed script), rotation algorithm

### L-004 — Template sheets use merged column groups of 4 per hour
**Date**: 2026-04-02
**Context**: Parsing `1 day template`, `3 hr template`, `4 hour template` sheets
**Problem**: Each hour occupies 4 columns (positions 1–4 within the hour). The hour header is in the first column of each group; the other 3 are sub-positions. pandas reads the header row as a mix of time values and NaN due to merged cells not being preserved. Sub-position headers (1, 2, 3, 4) appear in row 1.
**Resolution**: When parsing templates, treat every group of 4 columns as one hour block. Column index formula: `hour_index = (col - first_data_col) // 4`, `position = (col - first_data_col) % 4 + 1`. First data column varies by template type (col 2 for 3hr/4hr, col 4 for 1-day).
**Applies to**: library-service (template import), template builder UI

### L-005 — Category code naming convention
**Date**: 2026-04-02
**Context**: Mapping category sheet names to human-readable labels
**Problem**: Category codes in the source file are abbreviated and not self-documenting: `FGs`, `FGf`, `PGs`, `PGf`, `JBx`, `7`, `7B`, `8`, `8B`, `9`, `9B`, `c1–c3`, `y1`, `y1B`, `y2`, `y2B`, `duplex`, `duplexB`, `x`, `pd`, `d1–d4`, `d9`, `dc`, `dr`. Some are obvious, others (`duplex`, `x`, `pd`, `dc`, `dr`) are not.
**Resolution**: Confirmed mappings based on content analysis:
  - `FGs` = Foreign Golden Standards (slow) — international classics (Engelbert, Matt Monro, Beatles ballads)
  - `FGf` = Foreign Golden Standards (fast/uptempo) — Beatles upbeat, etc.
  - `PGs` = Philippine Golden Standards (slow) — Victor Wood, Nora Aunor
  - `PGf` = Philippine Golden (fast)
  - `JBx` = Jeepney Beat / OPM — Fred Panopio, Imelda Papin
  - `7` = 70s / `7B` = 70s subtype B — Kenny Rogers era
  - `8` = 80s / `8B` = 80s subtype B
  - `9` = 90s / `9B` = 90s subtype B
  - `c1–c3` = Contemporary (3 rotation sub-pools)
  - `y1`, `y2` = Young Contemporary / `y1B`, `y2B` = subtypes
  - `duplex`, `duplexB`, `x`, `pd`, `d1–d4`, `d9`, `dc`, `dr` = **unconfirmed** — need clarification from original users before finalizing labels
**Applies to**: library-service (category seed data), frontend (category display names)

### L-006 — Token efficiency: direct file reading beats xlsx skill for analysis
**Date**: 2026-04-02
**Context**: Initial attempt to analyze .xlsm files using the xlsx skill agent
**Problem**: The skill agent launched a subprocess with its own full context, which is slower and consumes more tokens for analysis tasks. The agent did not return in a reasonable time.
**Resolution**: Read files directly using `pandas.read_excel()` via Bash tool. Far more token-efficient for structured data extraction. Use the xlsx skill only when you need to *create* or *modify* Excel files with complex formatting.
**Applies to**: Any future Excel analysis tasks in this project

---

## Architecture

### L-007 — JSONB for rotation_rules avoids schema migrations as rules evolve
**Date**: 2026-04-02
**Context**: Deciding how to store per-station rotation rules
**Problem**: Rotation rules differ per station (some may care about artist separation, others about max plays per day, some have custom weights). A fixed-column table would require a schema migration every time a new rule type is needed.
**Resolution**: Store rules as `JSONB` in `rotation_rules.rules`. Define a TypeScript interface `RotationRules` that all services reference. New rule types are added to the interface + algorithm only — no DB migration needed.
**Applies to**: station-service, scheduler-service, docs/data-model.md

### L-008 — Playlist generation must be async (queue-based)
**Date**: 2026-04-02
**Context**: Designing the generation endpoint
**Problem**: Generating a full-day playlist (24 hours × 4 positions = 96 slots, each requiring a DB query + rotation check) could take several seconds. A synchronous HTTP response would timeout or block.
**Resolution**: Generation is always enqueued via BullMQ. The API returns `202 Accepted` with a `job_id`. Frontend polls `GET /jobs/:job_id/status` or subscribes to SSE. This also enables retry logic and cron scheduling without code duplication.
**Applies to**: scheduler-service, frontend (playlist generation UI)

---

### L-009 — Docker build context must be project root for monorepo Dockerfiles
**Date**: 2026-04-03
**Context**: Running `docker-compose up --build` for the first time
**Problem**: `build: ./services/library` sets the Docker build context to `./services/library`. Any `COPY` in the Dockerfile that references a file outside that directory (e.g., `COPY tsconfig.base.json ./` or `COPY pnpm-workspace.yaml ./`) fails with `not found`. This is a Docker design constraint: files outside the build context cannot be accessed.
**Resolution**: Changed all service build entries in `docker-compose.yml` to use `context: .` (project root) with an explicit `dockerfile:` path:
```yaml
build:
  context: .
  dockerfile: services/auth/Dockerfile
```
This makes the entire project root the build context. Added `.dockerignore` to exclude `node_modules`, `dist`, `.git` etc. so the context doesn't bloat.
**Applies to**: Every Dockerfile in this monorepo. Always use `context: .` + `dockerfile: services/<name>/Dockerfile` when a service needs files from the project root (tsconfig, pnpm-workspace.yaml, shared packages).

### L-010 — Inline parser in seed scripts; don't cross package boundaries via TS source imports
**Date**: 2026-04-03
**Context**: Creating the PlayGen seed script in `shared/db`
**Problem**: Initial attempt used a re-export file that imported directly from `../../services/library/src/services/importParser`. This creates a TypeScript source path dependency that works at compile time but breaks at runtime (`dist/` can't resolve another service's `src/`). It also couples the `@playgen/db` package to `@playgen/library-service` — a circular dependency risk.
**Resolution**: Inlined the three pure parser functions directly in the seed file. Seed scripts are one-time operational tools; the duplication is intentional and documented with a comment. The canonical implementation lives in `library-service/src/services/importParser.ts`.
**Applies to**: Any seed or migration script that needs logic from a service — always inline or extract to a true shared package, never import across service source boundaries.

### L-011 — `pnpm install --frozen-lockfile` fails without a committed lockfile
**Date**: 2026-04-03
**Context**: First `docker-compose up --build` attempt
**Problem**: `--frozen-lockfile` requires a `pnpm-lock.yaml` to already exist. Since the project was bootstrapped without running `pnpm install` locally first, no lockfile exists. Docker exits with code 1 immediately.
**Resolution**: Changed all Dockerfiles to use `--no-frozen-lockfile` for development. Before deploying to production: run `pnpm install` locally once to generate `pnpm-lock.yaml`, commit it, then switch back to `--frozen-lockfile` in Dockerfiles for reproducible production builds.
**Applies to**: All service Dockerfiles. Lockfile discipline: generate locally → commit → enforce in Docker.

### L-012 — Bash `&&`/`||` chains don't short-circuit as expected inside `$()`
**Date**: 2026-04-03
**Context**: Generating stub service `index.ts` files with a bash loop using a conditional port expression
**Problem**: The expression `port=$( [ "$svc" = "a" ] && echo 3003 || [ "$svc" = "b" ] && echo 3004 || echo 3005 )` does not short-circuit after the first match. Due to bash left-to-right operator precedence (all `&&`/`||` equal), when `svc=b` the chain evaluates as `((false||true) && echo 3004) || false) && echo 3005)`, echoing both `3004` and `3005`. The multiline value gets interpolated into the TypeScript heredoc, producing `const port = Number(process.env.PORT ?? 3004\n3005)` — a syntax error TypeScript rejects with exit code 2.
**Resolution**: Never use chained `&&`/`||` for multi-branch value selection in bash. Use `case` statements or explicit `if/elif` blocks:
```bash
case "$svc" in
  library)   port=3003 ;;
  scheduler) port=3004 ;;
  playlist)  port=3005 ;;
  *)         port=3006 ;;
esac
```
**Applies to**: Any bash script that generates source files with dynamic values. Always verify generated file content before trusting it compiled.

## Add entries below as development progresses

<!-- Template:
### L-XXX — Title
**Date**: YYYY-MM-DD
**Context**:
**Problem**:
**Resolution**:
**Applies to**:
-->
