# Security Policy

## Supported Versions

PlayGen ships from `main`. Only the latest deploy on Railway/Vercel receives security fixes.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security reports.**

Use GitHub's private vulnerability advisory feature:
[Report a vulnerability](https://github.com/rinehardramos/playgen-project/security/advisories/new)

We aim to acknowledge reports within 2 business days and ship a fix or mitigation within 14 days for HIGH/CRITICAL severity.

## Threat Model (summary)

PlayGen is a multi-tenant SaaS for radio playlist generation. The threats we explicitly defend against:

| Class | Mitigation | Where |
|---|---|---|
| Supply-chain attacks (compromised npm/pip/action) | All GitHub Actions SHA-pinned + `step-security/harden-runner` egress audit; `pnpm` `minimum-release-age=4320` (72h cooldown); `pnpm audit --audit-level=high` blocks merges; OSV-Scanner + CycloneDX SBOM in CI; `pip-audit` over `tools/`; Dependabot for npm/pip/docker/actions | `.github/workflows/`, `.github/dependabot.yml`, `.npmrc` |
| Brute-force on credentials | Per-route rate limits: `/auth/login` 5/min, `/auth/forgot-password` 3/min, `/auth/reset-password` 5/min; global 60/min on auth surface; `bcryptjs` cost 12; refresh-token rotation | `services/auth/src/{app.ts,routes/auth.ts}` |
| SQL injection | Parameterized queries throughout; whitelisted dynamic field names in services that build dynamic SQL fragments | `shared/db/src/client.ts`, `services/library/src/services/songService.ts` |
| Cross-tenant data exposure | JWT-embedded `company_id` + `requireCompanyMatch` / `requireStationAccess` middleware; row-level filtering on every query | `shared/middleware/src/index.ts` |
| Schema disclosure on validation errors | Auth error handler strips AJV `details[]`; generic 400 to client, full error logged | `services/auth/src/app.ts` |
| Body / multipart DoS | `bodyLimit: 100 KB` on auth, `1 MB` on library JSON; multipart `fileSize: 25 MB`, `files: 1`, `parts: 20`, `headerPairs: 100` | `services/auth/src/app.ts`, `services/library/src/index.ts` |
| Prototype pollution | Asserted in `services/auth/tests/unit/security.test.ts`; Fastify default JSON parser is safe | tests |
| Missing security headers | `@fastify/helmet` registered uniformly via `registerSecurity()` on every service: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, HSTS in production, CORP `same-site` | `shared/middleware/src/security.ts` |
| LLM prompt injection (DJ service) | Sanitization (NFKC + bidi/zero-width/control-byte strip + length cap) on every user-controlled field flowing into prompts; free-form fields wrapped in `<untrusted>` delimiters; injection heuristic detector for audit logging; LLM output scrubbed for JWTs / API keys / DSNs before persistence; human review gate before social publication | `services/dj/src/lib/promptGuard.ts`, `services/dj/src/lib/promptBuilder.ts` |
| Trojan Source attack (CVE-2021-42574) | Bidi override codepoints stripped from all LLM-bound user input | `services/dj/src/lib/promptGuard.ts` |
| Secret leakage via logs / errors | Auth handler returns generic messages; LLM output scrubber redacts `eyJ`-prefixed JWTs, `sk-`/`xoxb-`/`ghp-` API keys, and `postgres://` DSNs | `services/dj/src/lib/promptGuard.ts` |
| External upstream API keys (weather, news) | Moved to info-broker (single central key per provider). DJ holds zero upstream secrets. | `shared/info-broker-client/`, migration 055 |
| Per-station credential leakage via station admin UI | No longer applicable — weather_api_key/news_api_key columns dropped (migration 055). | `shared/db/src/migrations/055_drop_station_external_api_keys.sql` |
| DJ data exfiltration via inbound social tokens | Tokens now in broker's encrypted vault; DJ holds opaque UUID refs. | `services/dj/src/lib/infoBroker.ts` |

### Out of scope

- Denial of service from a determined attacker with botnet-level resources (we rely on Railway/Cloudflare upstream).
- Compromised developer workstation / stolen GitHub credentials (covered by GitHub's own controls + branch protection).
- Vulnerabilities in Railway, Vercel, Supabase, or other upstream platforms.
- Social engineering of station operators.

## Why we do not run Trivy

Trivy was compromised in 2024 (malicious Docker image push to Aqua's registry). Even though the patched version is safe, we keep it off the standard scanning path to minimize the supply-chain attack surface. We rely on:

1. **OSV-Scanner** (Google-maintained, narrower attack surface, broader CVE coverage) — primary
2. **`pnpm audit --audit-level=high`** (GHSA dataset) — blocking
3. **CodeQL** (SAST) — code-level
4. **Dependency Review** action — PR-time
5. **TruffleHog** (pinned to a specific tag, not `@main`) — secret scanning
6. **CycloneDX SBOM** — incident-response artifact
7. **`pip-audit`** — Python deps under `tools/`

If we re-add Trivy in the future, it will be pinned by digest, run inside a sandboxed CI job with `permissions: contents: read` and no secrets, and only after a release-attestation check.

## Running the security suite locally

```bash
pnpm install
pnpm run typecheck && pnpm run lint
pnpm run test:unit       # includes auth/tests/unit/security.test.ts and dj/tests/unit/promptGuard.test.ts
pnpm audit --audit-level=high
```

To run OSV-Scanner locally:

```bash
curl -fsSL -o /tmp/osv-scanner \
  https://github.com/google/osv-scanner/releases/download/v2.3.5/osv-scanner_darwin_arm64
chmod +x /tmp/osv-scanner
/tmp/osv-scanner --recursive --skip-git ./
```

## Security-relevant files

- `shared/middleware/src/security.ts` — uniform helmet + rate-limit factory
- `shared/middleware/src/index.ts` — `authenticate`, `requirePermission`, `requireStationAccess`, `requireCompanyMatch`, `requireFeature`
- `services/auth/src/app.ts` — `buildApp()` factory used by both prod and tests
- `services/auth/src/routes/auth.ts` — per-route rate limits + tightened JSON schemas
- `services/auth/tests/unit/security.test.ts` — HTTP-level regression suite
- `services/dj/src/lib/promptGuard.ts` — prompt-injection sanitization + detection + output scrubbing
- `services/dj/src/lib/promptBuilder.ts` — sanitization wired into every LLM prompt path
- `services/dj/tests/unit/promptGuard.test.ts` — prompt-injection regression suite
- `.github/workflows/security.yml` — CodeQL, OSV-Scanner, SBOM, pip-audit, dependency-review, secret-scan, owasp-audit
- `.github/workflows/ci.yml` — `pnpm audit --audit-level=high` (blocking) + harden-runner
- `.npmrc` — `minimum-release-age=4320`, `engine-strict`, `audit-level=high`
- `.github/dependabot.yml` — npm + pip + docker + github-actions
