# Lessons Learned

Self-improvement log. Rules are ALWAYS/NEVER. Review at session start. Format: `## [category] title — date` + **Trigger/Rule/Why** (+ example if non-obvious).

---

## [process] Prepend Homebrew PATH to every bash command — 2026-04-04
**Trigger**: `gh` returned `command not found`; Claude's shell doesn't source `.zshrc`.
**Rule**: ALWAYS start bash commands using `gh`/`brew`/Homebrew tools with `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"`. Before declaring a tool missing, exhaust PATH variants (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`).

## [process] GitHub Projects V2 — link + set Status atomically — 2026-04-04
**Trigger**: Created project wasn't visible in repo; items added via `item-add` didn't appear in any column.
**Rule**: After `gh project create`, immediately `gh project link <n> --owner <o> --repo <o>/<r>`. After `gh project item-add`, immediately `gh project item-edit --field-id <STATUS> --single-select-option-id <COL>`. When batch-creating issues destined for a board, add to board in the same script that creates them — capture URL → item-add → set Status.
**Why**: User-owned projects aren't auto-linked; V2 treats Status as just another field.

## [process] Fix root causes, never workarounds — 2026-04-04
**Rule**: ALWAYS write down what's broken and why in one sentence before changing code. NEVER patch symptoms (hardcoded values, skipped steps, special-cases, silent try/catch). If you can't state the root cause, keep investigating.

## [deployment] Never deploy directly to Railway — 2026-04-04
**Rule**: NEVER run `railway up`/`railway redeploy`. ALL deploys go through CI/CD (push to main → CI → CD). If the pipeline is backed up, wait. Only exception: explicit user authorization for an emergency.

## [deployment] `@fastify/rate-limit` v9 for Fastify v4 — 2026-04-04
**Trigger**: `FST_ERR_PLUGIN_VERSION_MISMATCH` — v10 requires Fastify v5; all PlayGen services are v4.27.
**Rule**: ALWAYS pin `"@fastify/rate-limit": "^9.0.0"` when the service uses `fastify@^4.x`.

## [deployment] Gateway envsubst must list every `${VAR}` — 2026-04-04
**Trigger**: Site down with `nginx: [emerg] unknown "dj_host" variable` — `${DJ_HOST}` was in nginx.conf.template but not in envsubst's var list.
**Rule**: When adding a new service to `nginx.conf.template`, ALWAYS add `${NEW_HOST}` to BOTH the envsubst list in `gateway/docker-start.sh` AND the Railway gateway env vars. envsubst with an explicit list leaves unlisted vars as literal text, which nginx then fails to parse.

## [deployment] Typecheck + verify Dockerfile before pushing workspace deps — 2026-04-05
**Trigger**: PR #163 CI failed — missing `@playgen/middleware` in `services/auth/package.json` passed locally (pnpm hoisting) but failed in Docker.
**Rule**: ALWAYS run `pnpm run typecheck` before `git push`. When adding `"@playgen/X": "workspace:*"` to a service, update its Dockerfile: `COPY shared/X/package.json` → `pnpm install` → `COPY shared/X` → `pnpm --filter @playgen/X build` → then service copy+build.

## [architecture] OpenRouter as the only LLM adapter — 2026-04-04
**Rule**: ALWAYS use OpenRouter (`OPENROUTER_API_KEY`, `https://openrouter.ai/api/v1`, model as config string like `anthropic/claude-sonnet-4-5`). Do NOT create Claude/OpenAI/Gemini adapters unless OpenRouter can't serve the use case.
**Why**: One key, one endpoint, config-driven model switching, cost routing.

## [architecture] DJ script review gate is mandatory — 2026-04-04
**Rule**: DJ pipeline MUST pause at `pending_review` after LLM generation. NEVER auto-proceed to TTS unless the station has `dj_auto_approve = true`.
**Why**: TTS costs real money per character; review catches bad scripts before sunk cost.

## [tooling] LM Studio embeddings: raw fetch + sequential only — 2026-04-04
**Trigger**: OpenAI SDK returned 192 dims (truncated from 768) on MoE models; batch input also returned truncated dims; single calls via fetch returned full dims.
**Rule**: ALWAYS call LM Studio embeddings via raw `fetch` (NEVER OpenAI SDK) and sequentially (NEVER batch array input). For PlayGen's agent KB, use `text-embedding-nomic-embed-code` (3584 dims) — better semantic clustering on technical content than `nomic-embed-text` (768).
