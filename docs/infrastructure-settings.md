# Infrastructure Settings Registry

> **Living document.** Updated whenever environment variables, platform settings, or manual configurations change.
> Never embed actual secret values — reference the secret name only.

---

## Railway (Backend Services)

Railway hosts all seven backend microservices and the managed PostgreSQL + Redis instances.

### Project-Level Variables (shared across all services)

| Variable / Setting | Value / Reference | Set By | Notes |
|---|---|---|---|
| `DATABASE_URL` | Railway Postgres internal URL | Railway dashboard | Format: `postgresql://postgres:[password]@[host].railway.internal:5432/railway` |
| `REDIS_URL` | Railway Redis internal URL | Railway dashboard | Format: `redis://default:[password]@[host].railway.internal:6379` |
| `JWT_ACCESS_SECRET` | Secret — min 32 chars | Railway dashboard / CI secret | Shared across all services that validate JWTs |
| `JWT_REFRESH_SECRET` | Secret — min 32 chars | Railway dashboard / CI secret | — |
| `JWT_ACCESS_EXPIRES_SEC` | `900` | Railway dashboard | 15 minutes |
| `JWT_REFRESH_EXPIRES_SEC` | `604800` | Railway dashboard | 7 days |

### Per-Service Variables

#### auth-service (:3001)

| Variable | Value / Reference | Notes |
|---|---|---|
| `AUTH_SERVICE_PORT` | `3001` | — |
| `DATABASE_URL` | Inherited from project | — |
| `JWT_ACCESS_SECRET` | Inherited from project | — |
| `JWT_REFRESH_SECRET` | Inherited from project | — |
| `JWT_ACCESS_EXPIRES_SEC` | Inherited from project | — |
| `JWT_REFRESH_EXPIRES_SEC` | Inherited from project | — |
| `RESEND_API_KEY` | Secret — `re_...` | From resend.com dashboard; required for email verification + password reset |
| `EMAIL_FROM` | `PlayGen <noreply@playgen.site>` | Must match verified Resend sender domain |
| `GOOGLE_CLIENT_ID` | Secret | From Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Secret | Same Google OAuth app |
| `GOOGLE_CALLBACK_URL` | `https://api.playgen.site/api/v1/auth/google/callback` | Must be added as Authorized Redirect URI in Google OAuth app |
| `FRONTEND_URL` | `https://www.playgen.site` | Used to redirect browser after OAuth callback |

#### station-service (:3002)

| Variable | Value / Reference | Notes |
|---|---|---|
| `STATION_SERVICE_PORT` | `3002` | — |
| `DATABASE_URL` | Inherited from project | — |

#### library-service (:3003)

| Variable | Value / Reference | Notes |
|---|---|---|
| `LIBRARY_SERVICE_PORT` | `3003` | — |
| `DATABASE_URL` | Inherited from project | — |

#### scheduler-service (:3004)

| Variable | Value / Reference | Notes |
|---|---|---|
| `SCHEDULER_SERVICE_PORT` | `3004` | — |
| `DATABASE_URL` | Inherited from project | — |
| `REDIS_URL` | Inherited from project | BullMQ job queue |

#### playlist-service (:3005)

| Variable | Value / Reference | Notes |
|---|---|---|
| `PLAYLIST_SERVICE_PORT` | `3005` | — |
| `DATABASE_URL` | Inherited from project | — |

#### analytics-service (:3006)

| Variable | Value / Reference | Notes |
|---|---|---|
| `ANALYTICS_SERVICE_PORT` | `3006` | — |
| `DATABASE_URL` | Inherited from project | — |

#### dj-service (:3007)

| Variable | Value / Reference | Notes |
|---|---|---|
| `DJ_SERVICE_PORT` | `3007` | — |
| `DATABASE_URL` | Inherited from project | — |
| `REDIS_URL` | Inherited from project | BullMQ generation + audio cleanup queues |
| `OPENROUTER_API_KEY` | Secret | From openrouter.ai/keys |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | — |
| `LLM_DEFAULT_MODEL` | `anthropic/claude-sonnet-4-5` | Default LLM model via OpenRouter |
| `OPENROUTER_SITE_URL` | `https://playgen.site` | Sent in OpenRouter request headers |
| `OPENROUTER_SITE_NAME` | `PlayGen` | Sent in OpenRouter request headers |
| `TTS_PROVIDER` | `openai` | `openai` or `elevenlabs` |
| `OPENAI_API_KEY` | Secret | Required when `TTS_PROVIDER=openai` |
| `ELEVENLABS_API_KEY` | Secret | Required when `TTS_PROVIDER=elevenlabs` |
| `TTS_DEFAULT_VOICE` | `alloy` | OpenAI TTS voice ID; ElevenLabs voice ID when using ElevenLabs |
| `STORAGE_PROVIDER` | `s3` (prod) / `local` (dev) | Where generated audio files are stored |
| `STORAGE_LOCAL_PATH` | `/app/data/audio` | Used when `STORAGE_PROVIDER=local` |
| `S3_BUCKET` | Secret | AWS S3 bucket name for audio storage |
| `S3_REGION` | `us-east-1` | AWS region for S3 bucket |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | Secret — 64-char hex (32-byte AES-256-GCM key) | Encrypts stored Facebook/Twitter OAuth tokens |
| `FACEBOOK_APP_ID` | Secret | Facebook app for social shoutout ingestion |
| `FACEBOOK_APP_SECRET` | Secret | — |
| `TWITTER_CLIENT_ID` | Secret | X/Twitter OAuth 2.0 app |
| `TWITTER_CLIENT_SECRET` | Secret | — |
| `SOCIAL_CALLBACK_BASE_URL` | `https://api.playgen.site/api/v1` | Base URL for OAuth callbacks |
| `FRONTEND_BASE_URL` | `https://playgen.site` | Used to redirect after OAuth connection |

### Railway Platform Settings

| Setting | Value | Notes |
|---|---|---|
| Health check path | `/health` | All services expose `GET /health → { status: 'ok' }` |
| Restart policy | On failure | Default Railway behavior |
| Sleep / scaling | Disabled (paid plan) | Services stay warm |
| Custom domain | `api.playgen.site` | Points to the gateway or individual service depending on routing |
| Migrations trigger | On deploy (CI/CD) | `pnpm --filter @playgen/db migrate` runs in CI before Railway deploy |

---

## Vercel (Frontend)

Vercel hosts the Next.js 14 frontend at `www.playgen.site`.

### Environment Variables

| Variable | Production | Preview | Development | Notes |
|---|---|---|---|---|
| `GATEWAY_URL` | `https://api.playgen.site` | Preview API URL | `http://localhost` | Server-side proxy target; not exposed to browser |
| `NEXT_PUBLIC_API_URL` | `https://www.playgen.site` | Preview frontend URL | `http://localhost:3000` | Browser-facing base URL for API links |

### Project Settings (changed from Vercel defaults)

| Setting | Value | Notes |
|---|---|---|
| Framework preset | Next.js | Auto-detected |
| Root directory | `frontend` | Monorepo — Vercel builds only the `frontend/` workspace |
| Build command | `pnpm run build` | — |
| Output directory | `.next` | — |
| Install command | `pnpm install` | — |
| Node.js version | 20.x | Matches backend services |

### Custom Domain

| Domain | Type | Target | Notes |
|---|---|---|---|
| `www.playgen.site` | CNAME | Vercel deployment URL | Primary frontend domain |
| `playgen.site` | A / redirect | → `www.playgen.site` | Apex domain redirect |

---

## External Services & Third-Party Integrations

### Resend (Email)

| Setting | Value / Reference | Notes |
|---|---|---|
| API Key | Secret — `RESEND_API_KEY` | Free tier: 3,000 emails/month |
| Verified sender domain | `playgen.site` | DNS TXT record required for domain verification |
| From address | `PlayGen <noreply@playgen.site>` | Must match verified domain |
| Use cases | Email verification, password reset | Triggered by auth-service |

### Google OAuth

| Setting | Value / Reference | Notes |
|---|---|---|
| Client ID | Secret — `GOOGLE_CLIENT_ID` | Created at Google Cloud Console → APIs & Services → Credentials |
| Client Secret | Secret — `GOOGLE_CLIENT_SECRET` | Same app |
| Authorized redirect URI (prod) | `https://api.playgen.site/api/v1/auth/google/callback` | Must be explicitly added in Google Console |
| Authorized redirect URI (dev) | `http://localhost/api/v1/auth/google/callback` | For local Docker Compose |
| OAuth scopes | `openid`, `email`, `profile` | — |

### OpenRouter (LLM)

| Setting | Value / Reference | Notes |
|---|---|---|
| API Key | Secret — `OPENROUTER_API_KEY` | From openrouter.ai/keys |
| Base URL | `https://openrouter.ai/api/v1` | — |
| Default model | `anthropic/claude-sonnet-4-5` | Configurable per DJ profile |
| Site URL header | `https://playgen.site` | Required by OpenRouter for attribution |

### AWS S3 (Audio Storage)

| Setting | Value / Reference | Notes |
|---|---|---|
| Bucket name | Secret — `S3_BUCKET` | Stores generated TTS audio and pre-recorded adlib clips |
| Region | `us-east-1` | — |
| Access credentials | AWS IAM credentials (not yet tracked) | Should use IAM role or access key with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the bucket |

### OpenAI (TTS)

| Setting | Value / Reference | Notes |
|---|---|---|
| API Key | Secret — `OPENAI_API_KEY` | Used by dj-service for TTS generation |
| Default voice | `alloy` | OpenAI TTS voice; overridable per DJ profile |

### ElevenLabs (TTS — alternative)

| Setting | Value / Reference | Notes |
|---|---|---|
| API Key | Secret — `ELEVENLABS_API_KEY` | Only required when `TTS_PROVIDER=elevenlabs` |

### Facebook (Social Shoutouts)

| Setting | Value / Reference | Notes |
|---|---|---|
| App ID | Secret — `FACEBOOK_APP_ID` | Created at developers.facebook.com |
| App Secret | Secret — `FACEBOOK_APP_SECRET` | — |
| Required permissions | `pages_read_engagement`, `pages_read_user_content`, `pages_show_list` | — |
| Valid OAuth Redirect URI | `https://api.playgen.site/api/v1/dj/social/facebook/callback` | Must be configured in Facebook app settings |

### X / Twitter (Social Shoutouts)

| Setting | Value / Reference | Notes |
|---|---|---|
| Client ID | Secret — `TWITTER_CLIENT_ID` | OAuth 2.0 app at developer.twitter.com |
| Client Secret | Secret — `TWITTER_CLIENT_SECRET` | — |
| Required scopes | `tweet.read`, `users.read`, `offline.access` | — |
| Callback URI | `https://api.playgen.site/api/v1/dj/social/twitter/callback` | Must be configured in Twitter app settings |
| Tier required | Basic ($100/mo) | Free tier does not support @mention search in production |

---

## GitHub Actions Secrets & Variables

Set in repo **Settings → Secrets → Actions** (secrets) and **Settings → Variables → Actions** (variables).

### Secrets

| Secret Name | Used For | Notes |
|---|---|---|
| `RAILWAY_TOKEN` | Railway deploy | Project deploy token from Railway dashboard |
| `VERCEL_TOKEN` | Vercel deploy | Personal access token from Vercel |
| `VERCEL_ORG_ID` | Vercel deploy | From `vercel link` output or Vercel dashboard |
| `VERCEL_PROJECT_ID` | Vercel deploy | From `vercel link` output or Vercel dashboard |
| `SUPABASE_DATABASE_URL` | DB migrations in CI | Supabase connection string; used to run `pnpm --filter @playgen/db migrate` |
| `OPENROUTER_API_KEY` | DJ service in prod | Same value as Railway env var |
| `OPENAI_API_KEY` | DJ service TTS in prod | Same value as Railway env var |

### Variables

| Variable Name | Value | Notes |
|---|---|---|
| `PRODUCTION_GATEWAY_URL` | `https://api.playgen.site` | Injected into Vercel build as `GATEWAY_URL` |
| `PRODUCTION_FRONTEND_URL` | `https://www.playgen.site` | Injected into Vercel build as `NEXT_PUBLIC_API_URL` |

---

## Manual / Out-of-Pipeline Configurations

| Configuration | Platform | Set By | Notes |
|---|---|---|---|
| Verified sender domain DNS | Resend / DNS provider | Manual — domain owner | TXT record for `playgen.site` email verification |
| Google OAuth redirect URIs | Google Cloud Console | Manual | Must be updated when new callback URLs are added |
| Facebook app OAuth redirect URIs | Facebook Developers | Manual | Must match `SOCIAL_CALLBACK_BASE_URL` |
| Twitter app callback URI | Twitter Developer Portal | Manual | — |
| Railway Postgres service | Railway dashboard | Railway auto-provisioned | Created when project was set up |
| Railway Redis service | Railway dashboard | Railway auto-provisioned | Created when project was set up |
| S3 bucket creation | AWS Console | Manual | Bucket policy must allow dj-service IAM credentials |
| Vercel project link | Vercel dashboard | Manual — `vercel link` | Sets `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` |
| `www.playgen.site` DNS records | DNS provider | Manual | CNAME → Vercel |
| `api.playgen.site` DNS records | DNS provider | Manual | Points to Railway service or gateway |

---

## Last Verified

| Platform | Last Verified | Verified By |
|---|---|---|
| Railway | 2026-04-06 | @claude-code |
| Vercel | 2026-04-06 | @claude-code |
| Resend | 2026-04-06 | @claude-code |
| Google OAuth | 2026-04-06 | @claude-code |
| OpenRouter | 2026-04-06 | @claude-code |
| GitHub Actions | 2026-04-06 | @claude-code |
| AWS S3 | 2026-04-06 | @claude-code (derived from `.env.example`) |
| Facebook / Twitter | 2026-04-06 | @claude-code (derived from `.env.example`) |
