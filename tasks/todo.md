# AI DJ Service — Implementation Plan

## Phase 1 MVP

### DB Migrations (016–022)
- [x] 016_create_dj_profiles.sql
- [x] 017_create_dj_daypart_assignments.sql
- [x] 018_create_dj_script_templates.sql
- [x] 019_create_dj_scripts.sql
- [x] 020_create_dj_segments.sql
- [x] 021_create_dj_show_manifests.sql
- [x] 022_add_dj_auto_approve_to_stations.sql

### Shared Types
- [ ] Add DJ types to shared/types/src/index.ts

### dj-service Scaffold
- [ ] services/dj/package.json
- [ ] services/dj/tsconfig.json
- [ ] services/dj/src/config.ts
- [ ] services/dj/src/db.ts
- [ ] services/dj/src/index.ts

### Core Services
- [ ] LLM adapter: src/adapters/llm/openrouter.ts
- [ ] TTS adapter interface: src/adapters/tts/interface.ts (stub)
- [ ] Prompt builder: src/lib/promptBuilder.ts
- [ ] Profile service + routes: src/services/profileService.ts + routes/profiles.ts
- [ ] Daypart service + routes: src/services/daypartService.ts + routes/dayparts.ts
- [ ] Script template service + routes: src/services/scriptTemplateService.ts
- [ ] Script generation pipeline (BullMQ): src/queues/djQueue.ts + workers/generationWorker.ts
- [ ] Review flow endpoints: src/routes/scripts.ts (approve/reject/edit)

### Infrastructure
- [ ] services/dj/Dockerfile
- [ ] Add dj-service to docker-compose.yml
- [ ] Add /api/v1/dj proxy to nginx gateway

### Seeds
- [ ] shared/db/src/seeds/007_dj_default_persona.sql (Alex)

## Review
- [ ] All Phase 1 GitHub issues moved to In Progress on board #2
