# Emanator PRD

## Original Problem Statement
Build a conversational AI builder (Emanator) that lets users submit a Creative Brief and auto-generates complete, multi-page, production-ready websites. The system should stream step-by-step build progress, render live previews, and handle billing/credits securely.

## Core Requirements
1. Creative Brief -> AI auto-builds complete multi-page sites
2. Step-by-step build walkthrough in chat (plan breakdown + file progress)
3. Contextual completion summaries
4. No AI refusals for image generation
5. Live preview with cross-file React imports (Babel inline transpilation)
6. Billing security: single entry point for AI calls, credit checks on all AI paths, no raw provider error leakage

## Architecture
- **Framework**: Next.js 14 App Router
- **Auth**: Supabase
- **DB**: Supabase (projects, chats, messages, project_files) + MongoDB (credits)
- **AI Providers**: OpenAI GPT-4o, Anthropic Claude (via Emergent LLM Key)
- **Payments**: Stripe (Emergent Test Key)
- **Preview**: Babel standalone inline transpiler in iframe with `window.__COMPONENTS__` registry

## What's Been Implemented

### Phase 1 - Core Pipeline (DONE)
- Creative Brief modal and auto-build pipeline
- Live streaming preview with postMessage
- Dark Aurora skeleton loading state during builds
- Regression guardrails (auto-retry on missing files/blank previews)
- Intent detection (isSimpleFrontendEdit fixed for briefs)
- Design excellence enforcement in prompt-builder and plan-executor

### Phase 2 - UX Enhancements (DONE)
- AI image refusal fix (anti-refusal directives)
- Stream request fix (SWC syntax error in stream-client.js)
- Dashboard race condition fix (missing useEffect deps)
- Babel cross-file import sandbox fix (lazy resolution wrappers)
- App build TaskMode fix (direct taskMode usage)
- Step-by-step plan walkthrough and dynamic completion summaries

### Phase 3 - Billing Security (DONE - Apr 8, 2026)
- Patched `/lib/ai/errors.js`: classifyProviderError translates billing/auth/rate-limit to safe messages
- Added credit pre-checks to `/lib/api/routes/chats.js` (non-streaming AI calls)
- Added credit pre-checks to `/lib/api/routes/diffs.js` (diff execution)
- Added credit pre-checks to `/lib/api/routes/assets.js` (image generation)
- Stream-handler already had credit checks; upgraded error classification
- Refactored `/lib/api/routes/public.js`: provider status uses key-existence checks only (no API pings)
- Removed `raw_error` from all API response payloads
- Image service error messages no longer expose env var names

### Bug Fix - Aurora Background Error Spam (DONE - Apr 8, 2026)
- Added null guards in `render()` (both versions) to prevent TypeError when canvas is destroyed
- Added try-catch with error throttling in `animate()` — logs max 3 errors, auto-stops after 10
- Synced both `/app/lib/auroraEngine.js` and `/app/frontend/src/lib/auroraEngine.js`

## Prioritized Backlog

### P0 (None remaining)

### P1
- Implement Phase 2-5 of conversational AI architecture (Intent Detection, Task Scope Classification, Silent Validation Retries, Learning System)
- CSV export option

### P2
- Deploy integration (Vercel/Netlify) — currently mocked
- Refactor `service.js` (~2600 lines) and `message-stream.js` (~1800 lines) into smaller modules

## Key Files
- `/app/lib/ai/errors.js` - Error classification and translation
- `/app/lib/api/stream-handler.js` - SSE streaming with credit checks
- `/app/lib/api/routes/chats.js` - Chat messages with credit gates
- `/app/lib/api/routes/diffs.js` - Diff application with credit gates
- `/app/lib/api/routes/assets.js` - Image generation with credit gates
- `/app/lib/api/routes/public.js` - Lightweight provider status
- `/app/lib/credits/service.js` - Credit costs, balances, deduction
- `/app/components/dashboard/tabs/PreviewTab.jsx` - Babel iframe preview
- `/app/lib/ai/message-stream.js` - Plan walkthrough streaming

## Test Credentials
- Email: testprov@test.com
- Password: password123
