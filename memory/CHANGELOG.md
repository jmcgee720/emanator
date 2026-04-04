# Emanator AI Builder — Changelog

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
