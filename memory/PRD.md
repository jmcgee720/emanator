# Emanator PRD

## Product Vision
Emanator is a conversational AI website builder that generates premium, visually stunning websites through natural language conversation.

## Image Pipeline Architecture (Critical)
1. `image-prefetch.js` generates base64 images + creates placeholder URLs
2. `message-stream.js` emits `generated_images_map` SSE event EARLY in stream
3. AI writes code using placeholder URLs
4. `file-operations.js` saves `_assets/` **ASYNCHRONOUSLY** (fire-and-forget)
5. `PreviewTab.jsx` injects `window.__GEN_IMAGE_MAP__` + `MutationObserver`

**CRITICAL: `_assets/` saves MUST be async to avoid SSE stream timeout (60s proxy limit)**

## Core System Self-Edit (Phase 1 - COMPLETE)
### Architecture
- `SELF_EDIT_TARGETS` in `constants.js` defines editable files
- Targets: Prompt Builder, Design System, Image Generator + all existing targets
- Backend `message-stream.js` completely REPLACES builder system prompt with code-editor prompt for self-edit
- "All Core System" provides file index, specific targets provide full file content
- Skips image prefetch, design intelligence, filesystem context, grounding

### Diff-Based Editing — `patch_files` Tool (COMPLETE)
- Dedicated `patch_files` tool in `tools.js` with structured `{ search, replace }` patches array
- Self-edit mode forces `patch_files` via `tool_choice` and filters toolset to only `patch_files`
- Server-side patch application with fuzzy whitespace matching (trimmed line comparison)
- Converts patched content to `update_files` format for the standard save pipeline
- `usePlanMode` explicitly disabled for self-edits (prevents wasted plan retries)
- Self-edits route to direct-save path (not diff pipeline) for immediate file persistence
- Legacy `<<<PATCHES>>>` text format still supported as fallback
- `validateExportsPreserved()` validates all named exports survive patching

### Phase 2: Silent Validation Retries (COMPLETE)
- When all patches fail (search strings don't match), auto-retries up to 2 times
- Collects diagnostic info: failed search strings, nearby actual file content
- Re-streams from AI with corrective context showing exact content that should be matched
- Partial success path: if some patches apply but others fail, saves partial result with status notification
- `selfEditPatchRetry` counter prevents infinite retry loops

### Phase 3: Auto-Reload after Apply to Live (COMPLETE)
- `promote-to-live` clears Node.js `require.cache` for each written file
- Touches files with `fs.utimesSync` to trigger Next.js file watcher
- Invalidates `filesystem.js` in-memory cache
- Frontend shows "Hot-reload triggered" toast immediately, then "Reload Complete" toast after 3s

### Phase 4: Enhanced Diff View (COMPLETE)
- Dual line numbers (original + new) in diff view
- Sticky summary header showing `+N additions`, `-N removals`, `X → Y lines`
- Collapsed unchanged regions with "··· N unchanged lines ···" separator (3-line context window)
- Improved color coding: emerald for additions, red for removals

### Phase 5: Intent Detection Fix (COMPLETE)
- Fixed `request_router` import naming mismatch: `routeRequest` → correct export name
- Previously caused `[PromptRouter] error: request_router is not a function` on every build

### Patch History Timeline (COMPLETE)
- `GET /api/projects/:id/patch-history` returns all pre-promote snapshots
- CodeTab has "History" toggle button showing timeline of all Apply to Live operations
- Each snapshot shows files edited, timestamp, and one-click restore button
- Restore uses existing rollback-live endpoint to write snapshot files back to disk
- History auto-refreshes after each Apply to Live

### Post-Edit Enhancement Suggestions (COMPLETE)
- `generateSelfEditSuggestions()` analyzes edited file path and content
- Context-aware: prompt-builder → accessibility/SEO/performance; design-system → dark mode/animations/spacing
- Appears as "What could enhance this further:" with 3 numbered suggestions after each self-edit
- Rule-based (no extra AI call) for zero latency/cost

### Response Quality Fix (COMPLETE)
- Self-edit prompt rules 6-10 enforce action-oriented behavior
- "Be ACTION-ORIENTED. Do NOT explain what you would do — just DO it."
- "Do NOT lecture about approaches, strategies, or steps."
- "You are editing EMANATOR'S OWN CODEBASE — not a user's website project."
- "Never suggest editing API routes, database logic, or authentication flows."
- "After applying patches, briefly note what changed and suggest improvements."

### Core Canvas — PM Portal (COMPLETE)
- Collaborative markdown canvas replaces iframe Preview for Core System projects only
- Both user and AI can read/write; rendered with interactive checkboxes, headers, bold text
- AI auto-appends "Recent Edits" log after every self-edit with file names + summary + timestamp
- Edit/Preview toggle for raw markdown editing; auto-saves with 1.5s debounce
- Stored in Supabase `project_canvas` table; handles old JSON→markdown migration
- SSE `canvas_update` event pushes live updates to the frontend

### Post-Edit Validation (COMPLETE)
- `validateExportsPreserved()` checks all named exports from original exist in modified file
- If exports are missing, falls back to appending AI suggestions as comments
- Destructive rewrite guard: files < 40% of original get AI content appended as comments

### Apply to Live (COMPLETE)
- Size guardrail: warns (not blocks) when files shrink significantly
- Toast notifications for success/failure/warnings
- Auto-reload: invalidates module caches after disk writes
- Rollback with snapshot support

### Capability Boundaries (LIVE)
- `buildCapabilityBoundaries()` in `prompt-builder.js` injected into every build
- Rules: No backend, no DB, no auth, no complex state, no fetch, no routing
- Positive framing of limitations

## Stream Timeout Safety Net
- `stream-client.js` detects when SSE connection closes without `done` event
- Synthesizes completion + error notification to unstick UI

## Key Files
- `/app/lib/ai/message-stream.js` — AI orchestrator, self-edit prompt, patch merger
- `/app/lib/ai/prompt-builder.js` — Capability boundaries, design recipes
- `/app/lib/ai/context.js` — Injects capability boundaries into system message
- `/app/lib/api/routes/live-promote.js` — Apply to Live with size guardrail + file-diff API
- `/app/components/dashboard/tabs/CodeTab.jsx` — Diff view, toast notifications
- `/app/components/dashboard/Dashboard.jsx` — Self-edit tab switching
- `/app/lib/stream-client.js` — Timeout safety net
- `/app/lib/constants.js` — SELF_EDIT_TARGETS

## Backlog
### P1
- Phase 3: Section Template Library
- Conversational AI phases 2-5
- CSV export

### P2
- Visual Quality Scoring, Style Transfer, Deploy integration
- Refactor message-stream.js (~2000 lines) and service.js (~2600 lines)

## Known Issues
- Preview tab shows SyntaxError for self-edit Node.js files (mitigated by auto-switching to Code tab)
- Next.js memory thrashing (mitigated with supervisor restart)
- Core System "New Chat" navigation occasionally redirects to Projects page (Playwright automation issue, works manually)
