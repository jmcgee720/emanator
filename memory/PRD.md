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

### Aurora Speed Reduction (DONE - Apr 8, 2026)
- Halved all STATE_CONFIGS speeds: idle 0.12→0.06, listening 0.18→0.09, thinking 0.25→0.12, responding 0.32→0.16
- Both engine files synced

### Preview Snapshot Lock (DONE - Apr 8, 2026)
- Added GET/PUT `/api/projects/{id}/preview-snapshot` endpoints storing compiled HTML + files content hash
- PreviewTab loads saved snapshot on project entry; if hash matches files → shows cached HTML (no recompile)
- After compilation, snapshot is saved with 1.5s debounce to project settings
- Snapshot cleared on: manual Refresh, new live stream start, user-initiated file changes
- Guarantees preview never changes between visits unless user explicitly triggers a change

### Post-Patch Verification Gate (DONE - Apr 8, 2026)
- Created `/lib/ai/patch-verification.js` with `verifyPatchResult()` and `buildVerifiedPatchResponse()`
- Extracts expected UI changes from user message (headings, active sections, form fields, removals, buttons, nav items, styles, labeled elements)
- Checks saved file content for those changes using regex + code analysis
- Returns structured response: FILES CHANGED, WHAT SHOULD NOW BE VISIBLE, HOW TO VERIFY, VERIFICATION STATUS
- All 10 completion message sites in `message-stream.js` replaced with verified responses
- Zero "Done —" generic strings remain
- Prompt-builder updated to instruct AI to describe exact visible results, blocking generic completion language
- Live-tested against tax app project: 8/8 verification checks passed (Profile default, Full Name, Email, Save Profile, Profile State Preview, tabs removed, sidebar kept)

### Phase 4 - Unified Secure AI Pipeline (DONE - Apr 8, 2026)
- **Service-level credit gate**: AIService requires `approveCreditGate()` before any provider call. Without it, `processMessageStream`, `processMessage`, `executePlanStream`, `processImageGeneration` all throw `ProviderError(billing)`
- **Provider call wrappers**: Added `callModelSafely()` (async) and `streamModelSafely()` (async generator) — enforce credit gate + translate raw provider errors via `classifyProviderError`
- **Platform keys only**: `_apiKey()` locked to `EMERGENT_LLM_KEY` → platform env fallback only. `image-service.js` now routes through EMERGENT_LLM_KEY + proxy
- **Route handler integration**: `stream-handler.js`, `chats.js`, `diffs.js` all call `approveCreditGate()` after credit balance check. Fork handler correctly skips it (no provider calls)
- **No bypass paths remain**: Audited all 4 AIService instantiations, 1 direct provider creation (image-service), all env key usage. All secured

### Provider Key Priority Flip (DONE - Apr 8, 2026)
- **Root cause**: Emergent proxy (`EMERGENT_LLM_KEY` → `EMERGENT_PROXY_URL`) has a hidden per-key spending cap that caused "Budget has been exceeded" errors even though the UI showed positive balance and "No limit"
- **Fix**: `_apiKey()` now uses direct provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) as PRIMARY. `EMERGENT_LLM_KEY` + proxy used only as fallback when direct keys are unavailable
- **`_proxyOptions()`** only injects proxy `baseURL` when actually using the Emergent key
- **`_streamWithFallback()`** tries Emergent proxy as last-resort fallback if direct key fails. Skips proxy entirely on `proxy_budget` errors
- **`ImageService`** flipped to same priority: direct `OPENAI_API_KEY` primary, Emergent key fallback
- **Error classification**: New `proxy_budget` error type in `errors.js` parses proxy-specific "Current cost: X, Max budget: Y" and shows: "Your Universal Key spending limit ($X) has been reached"
- **`stream-handler.js`**: Error events now include `limit_source` field (`universal_key_spending_cap` vs `platform_credits`)

### Post-Patch Verification Expansion (DONE - Apr 8, 2026)
- **New check types**: `select_element` (dropdown detection), `option_value` (option verification), `conditional_field` (conditional rendering detection)
- **Dropdown patterns**: Detects "make X a dropdown", "convert to select", "add select for", "select with options"
- **Option list parsing**: Extracts options from "options: A, B, C" and verifies a sample (first, middle, last) exist in code
- **Conditional field detection**: Detects "show X if Y selected", "appear when Z is chosen"
- **Code verification**: `<select>` element checks, `<option>` value checks, conditional rendering pattern checks (`&&`, ternary)
- **Runtime tests**: DOM-based tests for all new types — select presence, option existence, conditional field trigger simulation (dispatches change event on select, waits for React re-render, checks for field)
- **Heading regex fix**: `(?:to|say|read)` → `(?:to\s+(?:say|read)\s+|(?:to|say|read)\s+)` so "to say X" captures "X" not "say X"
- **Form field regex fix**: Stopped greedy capture of "text input" suffix (e.g., "Describe Other Expense text input" now captures "Describe Other Expense")

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
