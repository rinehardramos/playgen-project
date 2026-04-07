---
name: review-pr
description: Review a pull request against PlayGen standards. Layers PlayGen architecture invariants on top of the global /review-pr framework, then merges if approved or requests changes.
argument-hint: "[pr-number]"
context: fork
allowed-tools: Bash Read Grep Glob
---

# PR Review — PlayGen overlay

Run the **global `/review-pr` skill** first for the universal framework (gates, duplication check, CI, diff read, code-quality scrutiny, local checks via `/pre-pr-gate`, decision flow). Then apply the PlayGen-specific architecture rules below before merging.

If a finding from any layer below is blocking, request changes with the global skill's review-body template.

## PlayGen architecture invariants (CLAUDE.md)

Every PR MUST satisfy these. Violations are **critical blockers**.

### Multi-tenancy
- Every DB query on tenant data MUST filter by `company_id` AND `station_id` where applicable. Trace each WHERE clause — a missing tenant filter is a data leak.

### Stateless services
- No module-level mutable state in services. Session/user data comes from JWT, not in-memory caches keyed by user.

### Adapter pattern
- New TTS / LLM / export integrations MUST go through an interface (`TtsAdapter`, `LlmAdapter`, etc.). Direct API calls embedded in business logic are blockers.

### LLM via OpenRouter only
- Any new LLM integration MUST use OpenRouter (`OPENROUTER_API_KEY`, `https://openrouter.ai/api/v1`, model as config string like `anthropic/claude-sonnet-4-5`). Direct Claude/OpenAI/Gemini SDK usage is a blocker unless OpenRouter cannot serve the case (justify in PR).

### DJ review gate
- DJ scripts MUST NOT proceed to TTS unless status is `approved` OR the station has `dj_auto_approve = true`. Bypassing this gate wastes real money on TTS — **critical blocker**.

### Async generation via BullMQ
- CPU-bound or long-running work MUST be queued via BullMQ. No blocking heavy operations in Fastify request handlers.

### Shared packages
- Cross-service types in `shared/types`. DB access in `shared/db`. A service reimplementing a type that exists in `shared/types` is a blocker.

### Database & migrations (PlayGen-specific layer)
- Every new JSONB column MUST have a `COMMENT ON COLUMN` describing the expected schema.
- New migration numbers MUST be claimed in `tasks/agent-collab.md` Migration Reservation before writing.

### Frontend
- API calls via `lib/api.ts`, never raw `fetch`. Gateway URL from `process.env.NEXT_PUBLIC_API_URL` only.
- No hydration pitfalls in App Router server components.

### Ops
- Alpine-compatible Node deps only (`bcryptjs`, not `bcrypt`).
- New env vars documented in `.env.example`; services fail fast on missing required vars.
- Gateway changes: when adding a new `${VAR}` to `nginx.conf.template`, also add it to the envsubst list in `gateway/docker-start.sh` AND set the env var on Railway.

## Decision

Use the global skill's APPROVE/MERGE or REQUEST CHANGES templates. After merge, also move the linked issue to Done on PlayGen project board #2:

```bash
PROJECT_ID=$(gh project list --owner rinehardramos --format json | python3 -c "import json,sys; [print(p['id']) for p in json.load(sys.stdin).get('projects',[]) if p['number']==2]" | head -1)
STATUS_FIELD_ID=$(gh project field-list 2 --owner rinehardramos --format json | python3 -c "import json,sys; [print(f['id']) for f in json.load(sys.stdin).get('fields',[]) if f['name']=='Status']" | head -1)
DONE_OPT=$(gh project field-list 2 --owner rinehardramos --format json | python3 -c "import json,sys; [print(o['id']) for f in json.load(sys.stdin).get('fields',[]) if f['name']=='Status' for o in f.get('options',[]) if o['name']=='Done']" | head -1)
if [ -n "$ISSUE_NUMBER" ] && [ -n "$PROJECT_ID" ]; then
  ITEM_ID=$(gh project item-list 2 --owner rinehardramos --format json | python3 -c "import json,sys; [print(i['id']) for i in json.load(sys.stdin).get('items',[]) if i.get('content',{}).get('number')==${ISSUE_NUMBER:-0}]" | head -1)
  [ -n "$ITEM_ID" ] && gh project item-edit --project-id "$PROJECT_ID" --id "$ITEM_ID" --field-id "$STATUS_FIELD_ID" --single-select-option-id "$DONE_OPT"
fi
```
