---
name: pre-pr-gate
description: Mandatory local gate before any `git push`, PR creation, or merge in the PlayGen monorepo. Runs typecheck + lint + unit tests 1:1 with GitHub Actions, verifies Dockerfile/workspace-dep sync when relevant, and monitors CI/CD after push. Use BEFORE every push or PR.
allowed-tools: Bash Read
---

# Pre-PR Gate (NON-NEGOTIABLE)

Never `git push` without passing this gate. Local results must be 1:1 with GitHub Actions — if it passes here, it MUST pass in CI.

## 1. Run the full local suite
```bash
pnpm run typecheck && pnpm run lint && pnpm run test:unit
```
All three must pass. If any fail, fix root causes first — no bypass, no `--no-verify`.

## 2. Workspace dependency sync (when applicable)
If you added `"@playgen/X": "workspace:*"` to any `services/<svc>/package.json`, the Dockerfile MUST:
1. `COPY shared/X/package.json` before `pnpm install`
2. `COPY shared/X` source
3. `RUN pnpm --filter @playgen/X build` before the service build

Verify with:
```bash
docker build -f services/<svc>/Dockerfile . --no-cache 2>&1 | tail -20
```

**Why**: pnpm hoisting masks missing deps locally; Docker builds fail because only declared packages are in context.

## 3. Migration conflict check
If your PR touches `shared/db/migrations/`, read the **Migration Reservation** section of `tasks/agent-collab.md`. If two open PRs claim the same number, close the older one with an explanatory comment.

## 4. Post-push CI monitoring
After `git push`, actively monitor:
```bash
gh run list --limit 5
gh run view <run-id>    # if any job shows failure
```
If the pipeline fails, diagnose the trace and resolve autonomously until green. Never leave a failing pipeline for the user.

## 5. Never deploy directly
NEVER `railway up` / `railway redeploy`. All deployments go through the CI/CD pipeline (push to main → CI passes → CD deploys). If CD is backed up, wait — only emergency fixes with explicit user authorization bypass this.
