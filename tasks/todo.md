# AI DJ Service — Implementation Plan

## Phase 1 MVP

### DB Migrations (016–023)
- [x] 016_create_dj_profiles.sql
- [x] 017_create_dj_daypart_assignments.sql
- [x] 018_create_dj_script_templates.sql
- [x] 019_create_dj_scripts.sql
- [x] 020_create_dj_segments.sql
- [x] 021_create_dj_show_manifests.sql
- [x] 022_add_dj_auto_approve_to_stations.sql
- [x] 023_add_persona_config_to_dj_profiles.sql

### Shared Types
- [x] Add DJ types to shared/types/src/index.ts (Verified)

### dj-service Scaffold
- [x] services/dj/package.json
- [x] services/dj/tsconfig.json
- [x] services/dj/src/config.ts
- [x] services/dj/src/db.ts
- [x] services/dj/src/index.ts

### Core Services
- [x] LLM adapter: src/adapters/llm/openrouter.ts
- [x] TTS adapter interface: src/adapters/tts/interface.ts
- [x] TTS adapters: src/adapters/tts/openai.ts, src/adapters/tts/elevenlabs.ts
- [x] Prompt builder: src/lib/promptBuilder.ts
- [x] Profile service + routes: src/services/profileService.ts + routes/profiles.ts
- [x] Daypart service + routes: src/services/daypartService.ts + routes/dayparts.ts
- [x] Script template service + routes: src/services/scriptTemplateService.ts
- [x] Script generation pipeline (BullMQ): src/queues/djQueue.ts + workers/generationWorker.ts
- [x] Review flow endpoints: src/routes/scripts.ts (approve/reject/edit)

### Infrastructure
- [x] services/dj/Dockerfile
- [x] Add dj-service to docker-compose.yml (Verified)
- [x] Add /api/v1/dj/ proxy to nginx gateway (Verified & Updated)

### Seeds
- [x] shared/db/src/seeds/dj-default-persona.sql (Alex) (Verified)

### Testing
- [x] Unit tests for config, promptBuilder, openrouter
- [x] Unit tests for TTS adapters (Added)
- [x] Unit tests for generationWorker (Added)

## Review
- [x] All Phase 1 tasks verified and tested.
