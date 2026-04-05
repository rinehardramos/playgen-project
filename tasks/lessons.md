# Lessons Learned

> This file is the agent's self-improvement log. Every correction, mistake, or insight gets recorded here as a rule.
> Review this file at the start of every session.

---

## [process] Always prepend Homebrew PATH to bash commands — 2026-04-04

**Trigger**: User corrected: "use this always for using external tools, export PATH="/opt/homebrew/bin:$PATH"". `gh` was installed but returned `command not found` because Homebrew's bin is not in the default shell PATH when Claude executes commands.

**Rule**: ALWAYS start every bash command that uses `gh`, `brew`, or any Homebrew-installed tool with `export PATH="/opt/homebrew/bin:$PATH"`.

**Why**: Claude's shell environment doesn't source the user's `.zshrc`/`.bashrc`, so Homebrew tools at `/opt/homebrew/bin` are invisible without explicit PATH expansion.

**Example**:
```bash
export PATH="/opt/homebrew/bin:$PATH" && gh project list --owner rinehardramos
```

---

## [process] GitHub Projects must be explicitly linked to repos — 2026-04-04

**Trigger**: User reported the project wasn't showing in the repo's Projects tab after creation.

**Rule**: After creating a GitHub Project with `gh project create`, ALWAYS immediately run `gh project link <number> --owner <owner> --repo <owner>/<repo>` to make it visible in the repository.

**Why**: User-owned GitHub Projects are not automatically associated with a repo — they exist at the user level until explicitly linked.

**Example**:
```bash
export PATH="/opt/homebrew/bin:$PATH"
gh project create --owner rinehardramos --title "My Project"
gh project link 2 --owner rinehardramos --repo rinehardramos/playgen-project
```

---

## [process] GitHub Project items don't auto-populate columns — 2026-04-04

**Trigger**: Issues added to the board via `gh project item-add` showed on the board but not in any column (user said items weren't showing).

**Rule**: After `gh project item-add`, ALWAYS follow up with `gh project item-edit --field-id <STATUS_FIELD_ID> --single-select-option-id <COLUMN_ID>` to assign each item to a column. Items land in an uncategorized state without this.

**Why**: GitHub Projects V2 treats Status as just another field — adding an item to a project doesn't assign a column automatically.

**Example**:
```bash
ITEM_ID=$(gh project item-add 2 --owner rinehardramos --url "$ISSUE_URL" --format json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
gh project item-edit --project-id "$PROJECT_ID" --id "$ITEM_ID" --field-id "$STATUS_FIELD_ID" --single-select-option-id "$TODO_OPT_ID"
```

---

## [process] Never assume a tool is missing — check PATH first — 2026-04-04

**Trigger**: `which gh` returned nothing, declared "gh CLI not installed", asked user. User responded "gh is already installed."

**Rule**: Before declaring any tool missing, ALWAYS try expanding PATH variants: `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`. Only ask the user after exhausting PATH checks.

**Why**: Tools installed via Homebrew, nvm, pyenv, or cargo are path-dependent. A failed `which` doesn't mean the tool isn't installed.

**Example**:
```bash
# Wrong: which gh || echo "not installed"
# Right:
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && which gh
```

---

## [tooling] OpenAI SDK causes dimension truncation with LM Studio MoE models — 2026-04-04

**Trigger**: `pushEntries` failed with Qdrant "expected dim: 768, got 192" despite curl returning 768. The OpenAI SDK was the caller.

**Rule**: ALWAYS use raw `fetch` for LM Studio embedding calls, NEVER the OpenAI SDK. The SDK causes dimension truncation on MoE models (768 → 192). curl/fetch return the correct full dimensions consistently.

**Why**: LM Studio's MoE (Mixture of Experts) models with Matryoshka Representation Learning may interpret the OpenAI SDK request format differently, returning a truncated embedding dimension. Raw HTTP avoids this entirely.

**Example**:
```typescript
// ❌ Wrong — SDK truncates dims on LM Studio MoE models
const client = new OpenAI({ baseURL: 'http://localhost:1234/v1', apiKey: 'lm-studio' })
await client.embeddings.create({ model, input: text })

// ✅ Correct — raw fetch always returns full dimensions
await fetch('http://localhost:1234/v1/embeddings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, input: text })
})
```

---

## [tooling] LM Studio batch embedding returns inconsistent dims — 2026-04-04

**Trigger**: `embedBatch` with array input returned 192 dims; individual `embed` calls returned 768 dims with the same model.

**Rule**: ALWAYS embed sequentially (one string at a time) when using LM Studio. NEVER use batch array input — it returns truncated dimensions with MoE models.

**Why**: LM Studio's MoE embedding models behave differently for batch vs single inputs, likely returning a shorter Matryoshka representation for batch calls.

---

## [tooling] Use nomic-embed-code (3584 dims) over nomic-embed-text for technical KB — 2026-04-04

**Trigger**: User suggested switching to `text-embedding-nomic-embed-code` for the knowledge base.

**Rule**: For the PlayGen agent knowledge base, ALWAYS use `text-embedding-nomic-embed-code` (3584 dims). It produces better semantic clustering for technical content (code, error messages, architecture decisions) than `nomic-embed-text` (768 dims).

**Why**: Code-tuned embedding models encode technical vocabulary, stack traces, and engineering concepts with higher fidelity than general-purpose text models.

---

## [architecture] OpenRouter preferred over direct LLM provider SDKs — 2026-04-04

**Trigger**: User confirmed OpenRouter is better for consolidation when asked about LLM provider strategy.

**Rule**: ALWAYS use OpenRouter as the default LLM adapter. One API key (`OPENROUTER_API_KEY`), one OpenAI-compatible endpoint (`https://openrouter.ai/api/v1`), model as a config string (e.g. `anthropic/claude-sonnet-4-5`). Do NOT create separate Claude/OpenAI/Gemini adapters unless OpenRouter can't serve the use case.

**Why**: Simplifies the adapter layer to one implementation, reduces API key sprawl, enables model switching via config, and is cost-competitive via routing to cheapest provider per model.

---

## [architecture] Script review gate is mandatory before TTS generation — 2026-04-04

**Trigger**: User requested preview with reject/edit/accept before audio is generated.

**Rule**: The DJ pipeline MUST pause at `pending_review` after LLM script generation. NEVER auto-proceed to TTS without user approval unless the station has explicitly enabled `dj_auto_approve = true`.

**Why**: TTS costs real money per character. Generating audio for a bad script wastes credits and creates a poor UX. The review gate catches quality issues before they become sunk costs.

---

## [deployment] @fastify/rate-limit v10 requires Fastify v5 — use v9 for Fastify v4 — 2026-04-04

**Trigger**: Station and DJ services crashed in production because `@fastify/rate-limit@^10.3.0` is installed alongside `fastify@^4.27.0`. The rate-limit plugin v10 has a breaking change requiring Fastify v5's hook API.

**Rule**: ALWAYS pin `@fastify/rate-limit` to `^9.0.0` when the service uses `fastify@^4.x`. Check this whenever adding rate limiting to a new service.

**Why**: The `@fastify/rate-limit` v10 release dropped support for Fastify v4's hook system. Using v10 with Fastify v4 causes a crash at startup before any routes are registered.

**Example**:
```json
// ✅ Correct — compatible with fastify@^4.27.0
"@fastify/rate-limit": "^9.0.0"

// ❌ Wrong — requires fastify@^5.x
"@fastify/rate-limit": "^10.3.0"
```

---

## [process] When creating GitHub issues in batch, capture URLs and add to board atomically — 2026-04-04

**Trigger**: Created 27 issues across multiple bash calls but forgot to add them to the project board — user saw an empty board.

**Rule**: When creating issues that belong to a GitHub Project, ALWAYS add each issue to the board in the same script that creates it. Capture the URL from `gh issue create` output, immediately call `gh project item-add`, then set the Status column. Don't batch-create issues and add to board separately.

**Example**:
```bash
URL=$(gh issue create --repo "$REPO" --title "..." --body "..." 2>&1 | tail -1)
ITEM=$(gh project item-add 2 --owner rinehardramos --url "$URL" --format json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
gh project item-edit --project-id "$PROJECT_ID" --id "$ITEM" --field-id "$FIELD_ID" --single-select-option-id "$TODO_OPT"
```

---

## [deployment] NEVER deploy directly to Railway — always use the CI/CD pipeline — 2026-04-04

**Trigger**: Used `railway up --service <name> --detach` directly to fix a broken service. User corrected: "do not deploy directly! use the pipeline!"

**Rule**: NEVER run `railway up`, `railway redeploy`, or any direct Railway deploy commands. ALL deployments MUST go through the CD pipeline (push to main branch → CI passes → CD deploys).

**Why**: Direct deployments bypass CI checks, may deploy untested code, and are not tracked in git history. The pipeline ensures code is tested before deployment and maintains deployment auditability.

**How to apply**: Push fixes to main branch. If CI/CD pipeline is stuck in queue (GitHub Actions runner backlog), wait — do not bypass with manual deploys. Only exception: emergency fixes with user's explicit authorization.

---

## [deployment] Add DJ_HOST to gateway envsubst list when adding new services — 2026-04-04

**Trigger**: Site went down with `nginx: [emerg] unknown "dj_host" variable` because `${DJ_HOST}` was used in nginx.conf.template but not listed in the envsubst command in docker-start.sh.

**Rule**: Whenever a new service is added to nginx.conf.template, ALWAYS add `${NEW_HOST}` to BOTH the envsubst variable list in `gateway/docker-start.sh` AND set the env var in Railway's gateway service.

**Why**: envsubst with an explicit variable list leaves unlisted `${VARS}` as literal text, which nginx then tries to interpret as nginx variables. Unknown nginx variables cause nginx to fail to start.

**Example**: When adding DJ service routes, add `${DJ_HOST}` to:
1. `gateway/docker-start.sh`: envsubst `'... ${DJ_HOST} ...'`
2. Railway gateway service env vars: `DJ_HOST=dj.railway.internal`

---

## [dependencies] @fastify/rate-limit v10+ requires Fastify v5 — 2026-04-04

**Trigger**: Station service crash-looped on Railway with `FST_ERR_PLUGIN_VERSION_MISMATCH: @fastify/rate-limit - expected '5.x' fastify version, '4.29.1' is installed`.

**Rule**: ALWAYS check `@fastify/rate-limit` version compatibility before installing. For Fastify v4 services, use `@fastify/rate-limit@^9.0.0` (not v10+).

**Why**: `@fastify/rate-limit` v10+ is only compatible with Fastify v5. All PlayGen services use Fastify v4.27.x, so they must use `@fastify/rate-limit@^9.x`.

---

---

## [process] Fix root causes, never workarounds — 2026-04-04

**Trigger**: User corrected: "do not implement workarounds, fix the root cause in a systematic way"

**Rule**: ALWAYS diagnose the actual root cause before writing any fix. Never patch symptoms. If a fix feels like a bandaid (skipping a step, hardcoding, special-casing), stop and find why the underlying system is broken.

**Why**: Workarounds compound. They hide real bugs, create technical debt, and cause harder failures later. Root-cause fixes are the only acceptable resolution.

**How to apply**: Before changing a line of code, write down what EXACTLY is broken and why. If you can't explain the root cause in one sentence, keep investigating.

---

## [process] Run typecheck + Docker build before every push — 2026-04-05

**Trigger**: PR #163 failed CI because `pnpm run typecheck` wasn't run locally before pushing. A missing dependency (`@playgen/middleware`) in `services/auth/package.json` caused TypeScript build failure. The Docker build also failed because the Dockerfile didn't copy `shared/middleware/`.

**Rule**: ALWAYS run `pnpm run typecheck` before `git push`. When adding a new workspace package dependency, ALSO verify the service's Dockerfile copies that package in the build context.

**Why**: CI runs `pnpm run typecheck` and Docker builds as separate jobs. Local dev can mask failures because pnpm hoists workspace packages — a dependency missing from `package.json` may resolve fine locally via hoisting but fail in Docker (where only declared packages are in context).

**How to apply**:
1. Before any `git push`: run `pnpm run typecheck`
2. When adding `"@playgen/X": "workspace:*"` to a service's deps: check that service's Dockerfile copies `shared/X/package.json` and `shared/X` source, and builds `@playgen/X` before the service
3. Pattern: `COPY shared/X/package.json` → `RUN pnpm install` → `COPY shared/X` → `RUN pnpm --filter @playgen/X build`

