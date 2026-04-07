---
name: deploy-gotchas
description: Load-bearing deployment rules and past incident fixes for PlayGen. Use BEFORE touching Dockerfiles, nginx gateway config, Railway deploys, `@fastify/rate-limit` or other Fastify plugins, LLM/embedding integrations, the DJ script→TTS pipeline, or GitHub Projects V2 automation.
allowed-tools: Read Bash
---

# Deploy & Integration Gotchas

Rules captured from past incidents. Apply whichever sections match your current work.

## Fastify plugin versions (v4 services)
- `"@fastify/rate-limit": "^9.0.0"` — NEVER `^10.x`. v10 requires Fastify v5; all PlayGen services are v4.27. Crash: `FST_ERR_PLUGIN_VERSION_MISMATCH`.

## Nginx gateway (`gateway/nginx.conf.template`)
When adding a new service route, add `${NEW_HOST}` to BOTH:
1. The envsubst variable list in `gateway/docker-start.sh`
2. The Railway gateway service env vars (`NEW_HOST=new.railway.internal`)

**Why**: envsubst with an explicit list leaves unlisted `${VARS}` as literal text → nginx interprets as nginx vars → `[emerg] unknown "new_host" variable` → site down.

## Workspace dependency → Dockerfile
When adding `"@playgen/X": "workspace:*"` to a service, update its Dockerfile in this order:
```dockerfile
COPY shared/X/package.json shared/X/
RUN pnpm install
COPY shared/X shared/X
RUN pnpm --filter @playgen/X build
# ...then service build
```
**Why**: pnpm hoisting resolves the dep locally even when `package.json` is missing it. Docker has no hoist — build fails with a missing module.

## Never deploy directly to Railway
NEVER `railway up`, `railway redeploy`, or any direct Railway command. All deploys go through CI/CD (push to main → CI → CD). If backed up, wait. Only exception: explicit user authorization for emergencies.

## LLM adapters — OpenRouter only
Use OpenRouter as the single LLM adapter: `OPENROUTER_API_KEY`, `https://openrouter.ai/api/v1`, model as config string (e.g. `anthropic/claude-sonnet-4-5`). Do NOT create Claude/OpenAI/Gemini SDK adapters unless OpenRouter can't serve the use case.

## LM Studio embeddings — raw fetch, sequential
The OpenAI SDK truncates dimensions on MoE models (768 → 192). So does batch array input.
- ALWAYS call via raw `fetch`, NEVER the OpenAI SDK.
- ALWAYS embed one string at a time, NEVER batch.
- Use `text-embedding-nomic-embed-code` (3584 dims) for the agent KB — better semantic clustering on technical content than `nomic-embed-text` (768).

## DJ review gate
DJ pipeline MUST pause at `pending_review` after LLM script generation. NEVER auto-proceed to TTS unless the station has `dj_auto_approve = true`. TTS costs real money per character — the review gate catches bad scripts before sunk cost.

## Homebrew PATH in every bash call
Claude's shell doesn't source `.zshrc`. ALWAYS prepend when using `gh`, `brew`, Docker, or other Homebrew tools:
```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && gh ...
```
Before declaring any tool missing, exhaust PATH variants (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`).

## GitHub Projects V2 — link + set Status atomically
- After `gh project create`, immediately `gh project link <n> --owner <o> --repo <o>/<r>` (user-owned projects aren't auto-linked).
- After `gh project item-add`, immediately `gh project item-edit --field-id <STATUS> --single-select-option-id <COL>` (V2 treats Status as just another field — items land uncategorized otherwise).
- When batch-creating issues destined for a board, capture each URL → item-add → set Status in the same script. Don't batch separately.
