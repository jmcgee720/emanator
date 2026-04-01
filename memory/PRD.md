# Emanator AI Builder — Product Requirements Document

## Original Problem Statement
Continuously harden the Emanator AI Builder core system. Refine the Aurora UI, improve workspace navigation, execute a multi-step hardening plan (Steps 1-18) to enforce strict mode boundaries, safe patch generation, cross-project context checks, and tackle significant technical debt by refactoring massive files.

## Architecture
- **Frontend**: Next.js 14 App Router with Aurora dark luxury UI
- **Backend**: FastAPI proxy + Supabase + MongoDB
- **AI Engine**: OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key
- **Payments**: Stripe (Emergent Test Key)
- **Pipeline**: Classification -> Mode Routing -> Validation -> Execution

## What's Been Implemented

### Hardening Steps 1-17 (ALL COMPLETE)
- Step 1: `GET /api/projects/:id/files-index` + `projectFileIndex` state
- Step 2: Hard Grounding Gate (reject non-existent updates, require/validate `plan.projectId`)
- Step 3: Conversation Lock (block cross-project streaming, UI project labels)
- Step 4: Structured Task Modes (plan_only / patch_only / read_only_report classification + enforcement)
- Step 5: Large File Rewrite Safety (>70% replacement rejection)
- Step 7: Cross-Project Resolver (exact-path lookup, suggestion-only, no auto-switch)
- Step 8: UI Fixes (file count badge, chat mode label, wrong project warning)
- Steps 16-17: Execution Pipeline Separation (tool filtering, hasPlanCall guard, text-fallback blocking)

### Step 18: Final Validation Pass (COMPLETE)
- Full audit of all 22 checks across Steps 1-17
- All checks PASS with file + line evidence
- No regressions detected
- Status: READY TO CLOSE

### Service Extractions (COMPLETE)
- `pending-diff.js` — pending diff helpers extracted from service.js
- `internal-api-exec.js` — internal API execution extracted from service.js
- `read-only-report.js` — read-only inspection logic extracted from service.js

### Step 20: Phase 1 Route Modularization (COMPLETE — 2026-03-31)
- **route.js reduced from 4113 to 2038 lines (50.4% reduction)**
- Created `lib/api/helpers.js` — shared helpers (handleCORS, getAuthUser, checkAllowlist, initializeOwner)
- Extracted 17 route modules into `lib/api/routes/`:
  - `public.js` (3 endpoints: /, /health, /providers/status)
  - `auth.js` (1 endpoint: /auth/check)
  - `admin.js` (2 endpoints: /admin/monitored, /admin/activity)
  - `exports.js` (3 endpoints: exports CRUD + manifest import)
  - `credits.js` (3 endpoints: credits balance/use/add)
  - `search.js` (1 endpoint: global search)
  - `growth.js` (14 endpoints: trends, crawl, analyze, drafts, pages, feedback)
  - `personas.js` (3 endpoints: CRUD)
  - `imports.js` (3 endpoints: GitHub import, GitHub sync, ZIP import)
  - `deployments.js` (2 stub endpoints)
  - `snapshots.js` (3 endpoints: snapshots CRUD + restore)
  - `generations.js` (2 endpoints: generation runs, file events)
  - `memory.js` (4 endpoints: project memory CRUD)
  - `builder-status.js` (1 endpoint)
  - `prompt-library.js` (3 endpoints: CRUD)
  - `learning.js` (9 endpoints: learning, rules, preferences)
- Dispatcher pattern in route.js with preserved evaluation order
- Zero behavior changes — all endpoints verified working

### Step 21: Phase 2 Route Modularization (COMPLETE — 2026-03-31)
- **route.js reduced from 2038 to 119 lines (94.2% reduction from original 4113 lines)**
- route.js is now a pure dispatcher (~119 lines) with zero inline route logic
- Extracted 9 high-risk route modules into `lib/api/routes/`:
  - `admin-users.js` (182 lines: GET/POST/PUT/DELETE /admin/users)
  - `design.js` (42 lines: GET/PUT /projects/:id/design)
  - `canvas.js` (78 lines: GET/PUT /projects/:id/canvas)
  - `files.js` (140 lines: files CRUD, files-index, sync-repo)
  - `sandbox.js` (452 lines: create, diff, test-before-apply, promote, rollback)
  - `diffs.js` (174 lines: apply-diffs with DiffReviewGuard, dynamic imports preserved)
  - `assets.js` (325 lines: generate-image SSE, upload, attachments — raw Response preserved)
  - `chats.js` (389 lines: chats CRUD, messages, streaming, session forking)
  - `projects.js` (212 lines: projects CRUD, account/cleanup)
- Phase 2 dispatcher array with strict ordering (projectsRoutes LAST)
- All critical preservations verified:
  - Image generation SSE uses raw Response (not wrapped in handleCORS)
  - Chat streaming via handleStreamMessage intact
  - Dynamic imports in diffs.js remain dynamic
  - Self-edit enforcement intact
  - /projects/import (Phase 1) beats /projects/:id (Phase 2)
- Validated 16+ endpoints via curl tests — all return correct status codes

### Grounding Injection for AI Calls (COMPLETE — 2026-04-01)
- Created `buildProjectGroundingBlock()` helper in `lib/ai/service.js`
- Injects project identity (name, ID, core/project mode) + full file index into AI system prompts
- Injected into all 3 AI entry points: `processMessageStream`, `executePlanStream`, `processMessage`
- Prevents AI from hallucinating non-existent file paths during planning and code generation
- Strict rules block: only reference files from the index, explicitly mark new files as NEW

## Prioritized Backlog

### P0 — COMPLETE
- Phase 2 extraction DONE: route.js is now a 119-line pure dispatcher
- Grounding Injection DONE: all AI calls now receive project file index

### P1 — Growth
- CSV export option
- Phase 2-5 conversational AI architecture (Intent Detection, Task Scope Classification, Silent Validation Retries, Learning System)

### P2 — Future
- Deploy integration (Vercel/Netlify) — currently mocked

## Key Files
- `/app/lib/ai/service.js` — Core AI handler
- `/app/lib/ai/plan-validator.js` — Plan & patch validation
- `/app/lib/ai/intents.js` — Intent classification + request-mode gate
- `/app/lib/ai/tools.js` — Tool schemas (propose_plan, PLAN_ONLY_TOOLS)
- `/app/lib/supabase/db.js` — Database queries + cross-project resolvers
- `/app/lib/api/stream-handler.js` — SSE endpoint + Conversation Lock
- `/app/lib/api/helpers.js` — Shared route helpers (handleCORS, getAuthUser, checkAllowlist, initializeOwner)
- `/app/lib/api/routes/` — 26 extracted route modules (17 Phase 1 + 9 Phase 2)
- `/app/components/dashboard/Dashboard.jsx` — Main UI state
- `/app/components/dashboard/LeftPanel.jsx` — Sidebar + UI indicators
- `/app/app/api/[[...path]]/route.js` — Pure dispatcher (~119 lines)
