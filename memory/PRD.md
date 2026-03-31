# Emanator AI Builder — Product Requirements Document

## Original Problem Statement
Continuously harden the Emanator AI Builder core system. Refine the Aurora UI, improve workspace navigation, execute a multi-step hardening plan (Steps 1-18) to enforce strict mode boundaries, safe patch generation, cross-project context checks, and tackle significant technical debt by refactoring massive files.

## Architecture
- **Frontend**: Next.js 14 App Router with Aurora dark luxury UI
- **Backend**: FastAPI proxy + Supabase + MongoDB
- **AI Engine**: OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key
- **Payments**: Stripe (Emergent Test Key)
- **Pipeline**: Classification → Mode Routing → Validation → Execution

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

## Prioritized Backlog

### P0 — Next
- Refactor `app/api/[[...path]]/route.js` (~4100 lines) into smaller, modular route files

### P1 — Growth
- CSV export option

### P2 — Future
- Deploy integration (Vercel/Netlify) — currently mocked

## Key Files
- `/app/lib/ai/service.js` — Core AI handler
- `/app/lib/ai/plan-validator.js` — Plan & patch validation
- `/app/lib/ai/intents.js` — Intent classification + request-mode gate
- `/app/lib/ai/tools.js` — Tool schemas (propose_plan, PLAN_ONLY_TOOLS)
- `/app/lib/supabase/db.js` — Database queries + cross-project resolvers
- `/app/lib/api/stream-handler.js` — SSE endpoint + Conversation Lock
- `/app/components/dashboard/Dashboard.jsx` — Main UI state
- `/app/components/dashboard/LeftPanel.jsx` — Sidebar + UI indicators
- `/app/app/api/[[...path]]/route.js` — Catch-all API route (REFACTOR TARGET)
