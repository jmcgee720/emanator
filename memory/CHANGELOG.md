# Emanator AI Builder — Changelog

## 2026-04-06 — Platform Billing + Credits System (Fork 7)

### Added: Credit enforcement in generation pipeline
- Pre-check in `stream-handler.js`: if credits < estimated cost, injects conversational upsell message ("You're out of credits. Tap Buy Credits...") instead of calling provider
- Post-generation deduction: credits deducted after successful generation based on model cost
- SSE events: `credits_exhausted`, `credits_update`, `fallback_notice` propagated to frontend

### Added: Model-aware pricing
- `MODEL_COSTS` in `credits/service.js`: per-model credit costs (GPT-4o: 1.0, Haiku: 0.25, Opus: 2.5, etc.)
- `ModelSelector.jsx`: cost labels ("1.0 cr", "0.25 cr") with tier-colored indicators next to each model
- `/api/credits` GET endpoint now returns `modelCosts` alongside balance

### Added: Automatic model fallback
- `FALLBACK_MAP` in `service.js`: gpt-4o→gpt-4o-mini, claude-sonnet→gpt-4o, etc.
- `_switchToFallback()` now functional: swaps provider/model on provider errors
- `_streamWithFallback()` attempts fallback before surfacing errors, emits `_fallback_used` signal

### Added: Error translation layer
- `errors.js`: "budget" keyword added to billing classifier; unknown errors now say "Something went wrong" instead of exposing provider details
- Dashboard: toast says "Generation Issue" not "Generation Failed"

### Files Created
- `/app/backend/tests/test_credits_api.py`

### Files Modified
- `/app/lib/credits/service.js` — MODEL_COSTS, getModelCost(), estimateRequestCost()
- `/app/lib/api/routes/credits.js` — Returns modelCosts in GET response
- `/app/lib/api/stream-handler.js` — Credit pre-check, fallback interception, post-generation deduction
- `/app/lib/ai/service.js` — FALLBACK_MAP populated, _switchToFallback() wired, _streamWithFallback() with fallback attempt
- `/app/lib/ai/errors.js` — Budget keyword, product-level unknown error message
- `/app/lib/stream-client.js` — onCreditsExhausted, onCreditsUpdate, onFallbackNotice callbacks
- `/app/components/dashboard/Dashboard.jsx` — Credit event handlers in both stream callback blocks
- `/app/components/dashboard/ModelSelector.jsx` — MODEL_COST_TIERS, cost labels with tier colors

---

### Added: Canvas-based aurora background from user's GitHub repo
- Pulled `AuroraBackground.jsx` and `auroraEngine.js` from `github.com/jmcgee720/emanator`
- Canvas aurora replaces the old CSS-based `.em-aurora-containment` veil system on both Login and Dashboard pages
- `auroraEngine.js` — 1168-line SimplexNoise-driven canvas renderer with wiremesh curve-following light curtains
- `AuroraBackground.jsx` — 601-line React component with layer management toolbar (Shift+L), demo mode (Shift+D), and activity level visualization

### Wired: `activityLevel` prop (0→1) to chat state
- Spikes to 1 when `sendMessage` is called
- Maintains at 1 while `streamingMessageId` is non-null (AI generating)
- Decays ~6s back to 0 after streaming completes (0.008 per 50ms interval)
- Bumps +0.05 on each keystroke in the hero prompt textarea
- Engine smoothly interpolates via `_lerp(current, target, 0.008)` at 60fps

### Infrastructure
- Created `/api/aurora/config` (GET/POST) for layer/effect config persistence
- Made `<body>` background transparent so canvas (position:fixed, z-index:0) shows through
- Dashboard content at z-index:1 sits above canvas
- `<html>` retains dark `--em-void` background as fallback before JS hydrates

### Files Created
- `/app/components/AuroraBackground.jsx`
- `/app/lib/auroraEngine.js`
- `/app/lib/api/routes/aurora.js`

### Files Modified
- `/app/components/dashboard/Dashboard.jsx` — Import AuroraBackground, activityLevel state + decay useEffect, replace CSS veil divs
- `/app/components/auth/LoginPage.jsx` — Import AuroraBackground, replace CSS veil divs
- `/app/app/layout.js` — body background transparent
- `/app/app/globals.css` — html bg em-void, body bg transparent
- `/app/app/api/[[...path]]/route.js` — Register aurora route

---

### Added: `detectTaskMode()` in `intents.js`
- New function classifying user messages into `build` (default), `inspect` (read-only), or `config` (system settings)
- Config detection: system/emanator settings patterns, model/provider changes, enable/disable flags
- Inspect detection: question forms, analysis verbs, explicit read-only directives
- Inspect hard locks (read-only, inspection, no file-actions) always win even when build verbs present
- Build override: action verbs (fix, build, create, etc.) override soft inspect signals
- 29/29 unit tests pass

### Added: Task Mode Gate in `service.js`
- Runs immediately after `classifyRequestMode()`, BEFORE any build/plan logic
- **Config mode**: Streams a config-only response with system prompt directive, returns early. Never enters planner/builder/direct-edit.
- **Inspect mode**: Forces `requestMode = 'read_only_report'`, blocks `directEditMode`, blocks `projectManagerMode`. Existing enforcement handles the rest (chat_only tool mode, no plan, file_actions blocked, output validation with retry).
- **Build mode**: No change to existing pipeline.

### Files Modified
- `/app/lib/ai/intents.js` — Added `detectTaskMode()` with CONFIG/INSPECT/BUILD_OVERRIDE pattern arrays, exported
- `/app/lib/ai/service.js` — Added Task Mode Gate after classifyRequestMode(); config early-return; inspect → read_only_report override; build-only guards on directEditMode and projectManagerMode

---

## 2026-04-04 — Replace Preview Compiler with Babel AST Plugin (Fork 5)

### Removed: Regex-based module rewriting (REPLACED)
- Deleted `stripReactBindings()` — 10 chained regex replacements for stripping React/CSS imports
- Deleted `stripTypeScript()` — regex-based TypeScript annotation stripping
- Deleted all regex chains in `buildReactPreview()` for import stripping, export transforms, named export transforms
- Deleted regex-based transforms in the live update listener (streaming preview)

### Added: AST-based `__mkPlugin` Babel plugin
- Custom Babel plugin defined inline in the iframe `<script>` tag
- Uses `babel.types` API to handle `ImportDeclaration`, `ExportDefaultDeclaration`, `ExportNamedDeclaration`, `ExportAllDeclaration` via AST visitors
- Handles ALL code shapes: `export default function`, `export default () =>`, `const X = ...; export default X`, named exports, TypeScript, re-exports, strings containing "export" text
- Each file processed individually through `Babel.transform()` with `['react', ['typescript', { isTSX: true, allExtensions: true }]]` presets
- Files embedded as JSON data (`JSON.stringify` + `<` escaping) — eliminates all string concatenation/escaping issues
- Error overlay shows per-file compile errors via DOM API (no innerHTML injection)

### Verified: 27/27 unit tests + 10/10 e2e tests pass
- All 10 code shapes tested: function exports, arrow exports, class exports, named exports, TypeScript, re-exports, strings with "export", special chars in module names, anonymous arrows

### Files Modified
- `/app/components/dashboard/tabs/PreviewTab.jsx` — Replaced `buildReactPreview` function entirely + removed dead `stripReactBindings` and `stripTypeScript`

---

## 2026-04-04 — Fix Create-Project JSON.parse Error (Fork 5)

### Create-Project JSON.parse "column 5" Error (FIXED)
- **Root Cause**: The Python proxy (`server.py`) was parsing upstream JSON via `response.json()` then re-serializing with `JSONResponse(content=body)`. This double-serialization could corrupt responses in edge cases (e.g., content-type mismatch, chunked encoding). Additionally, the frontend used `response.json()` directly without safe error handling, so any malformed response crashed the entire create-project flow.
- **Backend Fix**: Changed proxy to pass through raw upstream response bytes (`Response(content=response.content)`) instead of parse/re-serialize. Eliminates any possibility of data corruption.
- **Frontend Fix**: Replaced all `response.json()` calls in `createProject`, `loadProjects`, `loadProjectData`, and `loadMessages` with safe `response.text()` + `try { JSON.parse(text) } catch` pattern. Malformed responses now gracefully degrade instead of crashing.

### Files Modified
- `/app/backend/server.py` — Proxy catch-all: raw response passthrough instead of JSON parse/re-serialize
- `/app/components/dashboard/Dashboard.jsx` — Safe JSON parsing in `createProject`, `loadProjects`, `loadProjectData`, `loadMessages`

---

## 2026-04-03 — Fix Live Preview Babel Runtime SyntaxError (Fork 4)

### Babel Inline Transpilation Regex Fix (COMPLETE)
- **Root Cause**: Unanchored regexes in `buildReactPreview()` (PreviewTab.jsx) were matching `export default` inside string literals and comments, corrupting code and producing invalid JS (e.g., `function $1;`).
- **Fix**: Anchored all `export` replacement regexes to line start (`^\s*...` with `gm` flag) so they only match actual export statements. Added `safeMod` escaping for module names containing backslashes or double quotes.
- **Verified**: 8/8 unit tests pass (basic exports, string preservation, class exports, named exports, special chars, indented exports, no broken $1 pattern, valid JS output). Live preview renders correctly in browser with no SyntaxErrors.

### Files Modified
- `/app/components/dashboard/tabs/PreviewTab.jsx` — Lines 186-197: Regex anchoring + safeMod escaping

---

## 2026-04-03 — Live Streaming Preview & CSS Layout Fix (Fork 3)

### Live Streaming Preview Updates (COMPLETE)
- **Backend**: Switched from time-based throttling (350ms) to length-based (every 300 chars) for `preview_partial` emissions in `service.js`. Root cause: The Emergent/OpenAI proxy sends tool call argument chunks as a rapid burst (~100ms total), making time-based throttling ineffective.
- **Backend**: `_extractPartialFileContent()` in `service.js` extracts partial JSX/code from the accumulated tool call arguments JSON.
- **Frontend**: `Dashboard.jsx` buffers incoming `preview_partial` events and drains them progressively at 200ms intervals for visible incremental updates.
- **Frontend**: `PreviewTab.jsx` creates the iframe shell HTML only ONCE when streaming starts, then uses `postMessage` for subsequent partial updates to avoid iframe reload flicker.
- **Frontend**: On build completion, remaining preview queue is flushed, then after a 300ms delay the final saved files are loaded.

### CSS Layout Fix — Preview Iframe Height: 0 (FIXED)
- **Root Cause**: `.em-aurora { position: relative; }` in `globals.css` was overriding Tailwind's `absolute` class on the `right-panel` div, causing the layout chain to collapse (iframe height: 0px).
- **Fix**: Added `.em-aurora.absolute { position: absolute; }` CSS override in `globals.css`.
- **Also**: Changed `TabsContent` in `RightPanel.jsx` to use `absolute inset-0` positioning for proper height propagation.

### Files Modified
- `/app/lib/ai/providers/openai.js` — yields `tool_args_delta` events during streaming
- `/app/lib/ai/service.js` — length-based throttling, `preview_partial` emissions
- `/app/components/dashboard/Dashboard.jsx` — progressive buffer for live preview partials
- `/app/components/dashboard/tabs/PreviewTab.jsx` — shell-once + postMessage live update approach
- `/app/components/dashboard/RightPanel.jsx` — absolute positioning for TabsContent
- `/app/app/globals.css` — CSS specificity fix for `.em-aurora.absolute`

---

## 2026-04-03 — Assistant Message UI Polish (Fork 2)
- Removed heavy card backgrounds from assistant messages
- Tightened spacing, removed intent badges
- Reduced avatar size, implemented clean `em-prose` typography

## 2026-04-03 — Direct-Build File Persistence (Fork 1)
- Forced `tool_choice` in direct-edit mode
- Guarded success messages to only emit when files actually saved

---

## Backlog
- Phase 2-5 conversational AI architecture (Intent, Scope, Validation, Learning)
- CSV export for Growth panel
- Deploy integration (Vercel/Netlify) — currently mocked
- Refactor service.js (~2600 lines → modular breakdown)
- Core System self-editing architecture
- Growth analytics panel
