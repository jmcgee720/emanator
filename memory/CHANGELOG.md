# Emanator AI Builder — Changelog

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
