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

### Post-Edit Validation (NEW)
- `validateExportsPreserved()` checks all named exports from original exist in modified file
- If exports are missing, falls back to appending AI suggestions as comments
- Destructive rewrite guard: files < 40% of original get AI content appended as comments

### Apply to Live (NEW)
- Size guardrail: warns (not blocks) when files shrink significantly
- Toast notifications for success/failure/warnings
- Auto-reload: invalidates module caches after disk writes
- Rollback with snapshot support

### Diff View (NEW)
- Code tab shows "Diff" toggle button for Core System files
- Fetches original file from disk via `/api/projects/:id/file-diff`
- Side-by-side diff: green for additions, red for removals

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
- `request_router` import naming mismatch (`routeRequest` vs `request_router`) — benign, caught by try/catch
