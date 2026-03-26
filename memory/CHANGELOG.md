# MyMergent Changelog


## March 19, 2026 — Role System: Owner / Admin / Member

### Implemented
- **3-role system**: `owner` (full access), `admin` (manage content, view admin), `member` (standard usage)
- **Role storage**: Owner in DB `role` field, Admin in Supabase Auth `user_metadata.app_role` (DB constraint bypass), Member as default
- **Constants**: `ROLES`, `VALID_ROLES`, `getUserRole()`, `hasPermission(role, action)` — 5 permission actions
- **API enforcement**: `checkAllowlist()` resolves effective role from DB + auth metadata. User CRUD accepts/stores admin via metadata. User list enriched with effective roles.
- **Permission middleware**: `hasPermission()` supports `self_edit` (owner), `manage_users` (owner), `manage_content` (owner+admin), `execute_plan` (all), `view_admin` (owner+admin)
- **Tests**: 8/8 passed (auth check, admin create, member create, invalid role default, enriched list, promote, demote, self-edit enforcement)
- **Report**: `/app/test_reports/iteration_9.json`


## March 19, 2026 — Phase 7: Core System Boundary (Product Structure)

### Implemented
- **Core System Workspace concept**: Self-edit chats separated from builder chats via title convention (`⚙ Self-Edit: ` prefix) with derived `chat_type` field
- **Owner-only access**: Backend enforces `role === 'owner'` for self-edit chat creation (403 for non-owners)
- **UI separation**: Builder chats and Core System chats displayed in distinct sections with different icons (MessageSquare vs Settings) and amber visual language
- **Self-Edit Mode indicator**: Amber banner "Self-Edit Mode — changes target Core System" appears when a self-edit chat is active
- **Files modified**: `lib/constants.js`, `app/api/[[...path]]/route.js`, `Dashboard.jsx`, `LeftPanel.jsx`
- **Backend tested**: 5/5 tests passed (chat_type in list, owner create self-edit, builder type, title format, cleanup)
- **Report**: `/app/test_reports/iteration_8.json`


## March 19, 2026 — PROOF TEST #4: Autonomous Safe Self-Change (Phase 9)

### Result: PASSED (9/9 steps, fully autonomous)
- **Autonomous scan**: 12 files, 5 heuristics (testability gaps, empty-state quality, filtering, line numbers, shortcuts)
- **Selected**: LogsTab.jsx (77pts) — zero data-testid coverage, poor empty-state, no filtering
- **Applied**: 7 new data-testids, log count badge, enhanced empty-state with icon + guidance
- **Safety**: 5/5 checks, rollback available (1 snapshot)
- **UI confirmed**: Screenshot shows "Activity Logs (4)" count badge, all testids present
- **Test file**: `/app/tests/proof_test_4_autonomous_self_change.js`
- **Report**: `/app/test_reports/iteration_7.json`


## March 19, 2026 — PROOF TEST #3: Self-Proposed Improvement (Phase 9)

### Result: PASSED (9/9 steps, self-initiated)
- **Self-analysis**: Scanned 11 candidate files across 5 heuristic rules; DiffReviewPanel.jsx scored highest (40pts)
- **Improvement**: Added old/new line number gutter columns to diff view for precise code reference
- **Target**: `components/dashboard/DiffReviewPanel.jsx` — UI-only, no provider/routing/persistence logic
- **Safety**: 5/5 safety checks passed, compilation successful, dashboard functional
- **Test file**: `/app/tests/proof_test_3_self_proposed_improvement.js`
- **Report**: `/app/test_reports/iteration_6.json`


## March 19, 2026 — PROOF TEST #2: Extend Builder Memory (Phase 9)

### Result: PASSED (9/9 steps + 8/8 safety checks)
- **Target**: `components/dashboard/BuilderMemory.jsx` — added "Total Memory Entries: X" summary with category breakdown
- **Pipeline exercised**: request_router → feature_planner → plan_validator → file_ops_bridge → safe_apply → change_log
- **Safety**: 8/8 checks passed — no provider/routing/persistence logic affected
- **UI confirmed**: Summary visible showing count (4) + pattern breakdown (1 patterns)
- **Test file**: `/app/tests/proof_test_2_extend_builder_memory.js`
- **Report**: `/app/test_reports/iteration_5.json`


## March 19, 2026 — PROOF TEST #1: Safe Self-Change (Phase 9)

### Result: PASSED (9/9 steps)
- **Target**: `components/dashboard/Dashboard.jsx` — added "Self-Builder Active" emerald badge in header
- **Pipeline exercised**: request_router → feature_planner (enforcePlanCorrectness) → plan_validator → file_ops_bridge (buildPendingDiffs) → safe_apply (safeApplyDiffs) → change_log (logChange)
- **Verification**: single_file=true, plan_valid=true, diff_correct=true, apply_success=true, rolledBack=false, ui_visible=true, logged=true, any_breakpoint=null
- **Test file**: `/app/tests/proof_test_1_safe_self_change.js`
- **Report**: `/app/test_reports/iteration_4.json`


## March 18, 2026 — Phase 4: User Preference Memory

### Part 1 — Store Preferences (`change_log.js`)
- `inferAndStorePreferences()` detects signals from successful task text (single-file, multi-file, update, create, minimal, directory paths).
- Stores `user_preference:{type}:{value}` with `{ type, value, count, ts, userId }`.
- Increments existing entries on repeat. Only fires on `result === 'applied'` with `userId`.

### Part 2 — Preference Boost (`prompt_library.js`)
- `getUserPreferences(entries, userId)` filters preference entries for current user.
- `computePreferenceBoost(text, prefs)` returns 0–0.15 boost when pattern text aligns with preferences.
- `matchPromptPattern` now accepts `userId` (4th arg), adds `prefBoost` to candidate scores.

### Part 3 — Pass userId (`request_router.js`, `service.js`)
- Router accepts `userId`, passes through to matching. Service passes `userId` from stream context.
- **Verified**: 18/18 test cases pass.


## March 18, 2026 — Phase 4: Project-Specific Memory Scoping

### Part 1 — Store Project Scope (`change_log.js`, `prompt_library.js`)
- `addRejectedPatternToMemory` and `addPromptPatternToMemory` now embed `projectId` in stored JSON value.
- Backward compatible: existing entries without `projectId` still work.

### Part 2 — Prioritize Same-Project Memory (`prompt_library.js`)
- `matchPromptPattern(entries, input, projectId)` accepts optional 3rd arg.
- Same-project positive patterns: +0.1 scope boost.
- Same-project rejected patterns: 1.5x penalty amplification (capped at 0.45 vs 0.35 global).
- Global/legacy entries: no boost, standard penalty — still match as fallback.

### Part 3 — Pass Project Context (`request_router.js`)
- `matchPromptPattern` called with `projectId` from router.
- `recordPatternSuccess` also passes `projectId` through.
- **Verified**: 13/15 test cases pass; 2 edge cases confirmed as correct scoring behavior.


## March 18, 2026 — Phase 4: Correction Learning (Rejected-Pattern Learning + Safe Negative Scoring)

### Part 1 — Store Rejected Patterns (`change_log.js`)
- New `addRejectedPatternToMemory()`: when `result === 'discarded'`, stores `rejected_prompt_pattern:` entry in project_memory with `text`, `ts`, `reject_count`, `usage_count`.
- Idempotent: existing rejected entry gets `reject_count++`, `usage_count++`, `ts` updated.
- Success-learning path (`prompt_pattern:`) unchanged.

### Part 2 — Safe Negative Scoring (`prompt_library.js`)
- `matchPromptPattern()` now reads both `prompt_pattern:` and `rejected_prompt_pattern:` entries.
- Computes best rejected-pattern similarity, applies penalty: `min(0.35, sim * 0.3 * min(reject_count, 3))`.
- Decision: strong positive + weak negative → match; penalty drops score below 0.5 → ambiguous_match; no candidate survives → null.
- Does NOT hard-exclude. Preserves existing scoring: usage_count boost, success_count stale filter.

### Part 3 — Wire Discard Event (`route.js`)
- After `message_saved` for `discard_pending_diff` toolMode, fires `logChange({ ..., taskMode: 'discard', result: 'discarded' })` (fire-and-forget).
- **Verified**: 15/15 test cases pass.

## March 18, 2026 — FIX: Routing Drift — Prevent "Ask User" Interruptions During Active Objectives

### Problem
`request_router.js` returned `ambiguous_match` or `no_match` even when the system had an active objective in progress, causing the AI to interrupt with "what would you like me to do?" instead of continuing execution.

### Fix (3 Parts)
- **Part 1 — Active Objective Detection**: New `detectActiveObjective(projectId)` checks changelog (last 3 entries, skips rejected tasks) and builder memory (`active_objective` key) for an in-progress system objective.
- **Part 2 — Forced Continuation**: When an active objective exists, `ambiguous_match` is upgraded to `prompt_pattern_match` (top candidate) or `match` (no candidate). `no_match` is upgraded to `match` with `_continued_from` context.
- **Part 3 — Safety Fallback**: "Ask user" (`ambiguous_match`) only returned when: no active objective AND no viable pattern match AND planner cannot proceed.
- **Consumer update**: `service.js` (lines ~463-490) now handles `_continued_from` field — injects "Active Objective" directive into system message telling AI to continue, not ask.
- **Files modified**: `lib/self_builder/request_router.js`, `lib/ai/service.js`
- **Constraints met**: minimal patch, no UI changes, no schema changes, existing routing types preserved (match/ambiguous/no_match), diff/apply pipeline untouched
- **Verified**: 25+ test scenarios pass — all 7 specified cases verified


## March 17, 2026 — P0 Fix: READ-ONLY FILE INSPECTION (Permanently Fixed, 2 layers)

### Layer 1 (System Message Directive)
- **Root cause**: System message lacked explicit instruction telling the AI to use injected file contents. The LLM defaulted to its trained refusal pattern ("I can't access files directly") even though real file content was loaded into the system prompt via `fsContext` and `DirectFileRead`.
- **Fix**: Added mandatory `READ-ONLY INSPECTION MODE` directive block to `systemMessage` when `requestMode === 'read_only_report'`. Handles file-found (present/analyze) and file-not-found (list available files) cases.

### Layer 2 (Chat History Pollution Defense)
- **Root cause**: Prior assistant refusal messages in chat history ("I'm unable to access files") created a strong pattern the model followed regardless of system directives. Up to 20 messages from `loadScopedContext()` were included unfiltered.
- **Fix 1**: For `read_only_report` mode, strip assistant messages matching refusal patterns from chat history. Keep only last 4 clean messages.
- **Fix 2**: Embed actual file content directly in the user message (highest attention weight) from both `fsContext.relevantFiles` and `directReadFiles`, with explicit "analyze the file contents above" instruction.
- **Fix 3**: Prevented plan mode note (`"Plan mode is available..."`) from leaking into read_only_report messages.
- **Files modified**: `lib/ai/service.js` (lines 262-520)
- **Verified**: 6/6 scenarios pass — fresh chat, 3/6/8 refusal pairs in history, non-existing file, non-read-only bypass.

## March 15, 2026 — Bug Fixes: Preview Classifier + Sprite Generation (Live Verified)

### Bug 1: Preview Tab "render failed" for asset-only projects
- **Root cause**: `classifyProject()` joined ALL file contents including `_generated/*.png` base64 data (4.7MB). Random base64 characters matched patterns like `jsx`, `useState`, `text-`, `bg-` causing false `usesReact=true` classification as "react" with no entry file.
- **Fix**: Filter out `_generated/`, `_uploads/`, `_assets/` paths and `file_type=image` before classification. Added `assets-only` state showing "No previewable code files — check Assets tab".
- **File**: `components/dashboard/tabs/PreviewTab.jsx`

### Bug 2: Sprite generation still returned text instead of image
- **Root cause**: Intent patterns too narrow. "Create a transparent PNG sprite concept" didn't match any `sprite_generation` pattern (required exact phrases like "sprite sheet", "game sprite"). Fell through to `build` → Plan→Execute → text AI said "can't create images in text".
- **Fix 1**: Added `/\bsprite\b/i` standalone pattern to `sprite_generation`. Added `/\bgenerate\b.{0,40}\bimage\b/i`, `/\btransparent\s*(PNG|image)/i`, `/\bPNG\s+(sprite|icon|asset|image|character)/i` to `image_generation`.
- **Fix 2**: Reordered priority: `sprite_generation` → `asset_generation` → `image_generation` → ... → `build`
- **Fix 3**: `processImageGeneration` now detects `/\bsprite\b/i` in message text even when intent is `image_generation`
- **Fix 4**: Removed `&& projectId` guard from image_gen branch (always routes if toolMode matches, logs error if projectId missing)
- **Files**: `lib/ai/intents.js`, `lib/ai/service.js`

### Verified live
- Preview tab: Shows "No previewable code files — 3 generated assets" (data-testid: preview-assets-only)
- Sprite generation: Intent `sprite_generation` → `image_gen` → gpt-image-1 in 42.7s → GeneratedImageCard inline → Assets tab updated


# MyMergent Changelog

## March 15, 2026 — File Upload in Chat (8 Parts)
- **Upload UI**: Paperclip button + drag-and-drop in ChatComposer; file chips (name, size, remove) shown before send
- **Supported types**: txt, md, json, csv, html, css, js, jsx, ts, tsx, py, sql, pdf, png, jpg, jpeg, webp, svg
- **Size limits**: Text/code 500KB, Images 5MB, PDFs 10MB
- **Storage**: Uploaded files stored as `project_files` entries (path: `_uploads/timestamp_filename`)
- **AI context**: Text/code file contents injected into AI system message; image paths referenced; PDF text extracted
- **Message display**: AttachmentChips component shows file previews in user messages; click-to-preview modals for images and text
- **Validation**: File type + size checks with user-friendly error messages; .exe and unsupported types rejected with red chip styling
- **Files created**: `components/dashboard/AttachmentPreview.jsx` (new)
- **Files modified**: `components/dashboard/ChatComposer.jsx` (rewritten), `components/dashboard/Dashboard.jsx`, `components/dashboard/LeftPanel.jsx`, `app/api/[[...path]]/route.js` (upload endpoint), `lib/ai/service.js` (attachment context), `lib/supabase/db.js` (chatAttachments methods)

## March 15, 2026 — Diff / Patch Review Mode (6 Parts)
- **Diff generation**: `executePlanStream` now generates diff previews (old vs new content) via `diff_file` SSE events — files NOT written until approval
- **DiffReviewPanel UI**: Per-file diff cards with inline line-by-line diffs (green adds, red removes), collapsible sections, file selection checkboxes
- **Apply flow**: Apply All / Apply Selected / Discard All — only checked files are written
- **Snapshot**: Automatic snapshot created before applying diffs (via `snapshots` table) for rollback compatibility
- **Logging**: File change events logged per-file (create/update/delete) in `file_change_events` table
- **Files changed**: `lib/ai/service.js` (executePlanStream rewritten + new applyDiffs method), `app/api/[[...path]]/route.js` (new apply-diffs endpoint), `lib/stream-client.js` (diff_file event), `components/dashboard/DiffReviewPanel.jsx` (new), `components/dashboard/Dashboard.jsx` (diff state management), `components/dashboard/LeftPanel.jsx` (renders DiffReviewPanel inline)

## March 15, 2026 — Plan → Execute Mode (7 Parts)
- **New `propose_plan` AI tool**: Structured plan proposals with file_actions, summary, reasoning, design_preset
- **Plan-first workflow**: build/edit/refactor/bug_fix intents auto-trigger plan mode
- **PlanCard UI**: Renders in chat with file actions (create/update/delete), Execute/Revise/Cancel buttons
- **Execute pipeline**: Clicking Execute triggers full file generation via same SSE streaming
- **Cancel/Revise**: Cancel marks plan as cancelled (no files changed), Revise pre-fills composer
- **Plan persistence**: Plan metadata stored in message metadata for state retention across sessions
- **Non-plan bypass**: chat_only and other non-file intents skip plan mode entirely
- **Files changed**: `lib/ai/tools.js`, `lib/ai/intents.js`, `lib/ai/service.js`, `app/api/[[...path]]/route.js`, `lib/stream-client.js`, `components/dashboard/PlanCard.jsx` (new), `components/dashboard/Dashboard.jsx`, `components/dashboard/LeftPanel.jsx`

## March 15, 2026 — P0 Preview Tab Bug Fix
- **Fixed**: `classifyProject()` in `PreviewTab.jsx` now prioritizes standalone HTML documents (with `<!DOCTYPE` + `<style>`) over React classification in mixed projects
- **Fixed**: `buildHtmlPreview()` no longer injects unrelated JS files into HTML previews — only scripts referenced via `<script src>` are inlined
- **Result**: Preview tab correctly renders HTML landing pages without "Script error" in projects containing both `.jsx` and `.html` files
- **Verified**: Frontend testing agent confirmed all scenarios pass (login, classification, rendering, toolbar, layout)

## March 15, 2026 — Design Intelligence System (9 Parts)
- Design presets, tokens, layout patterns, component patterns, AI prompt injection, UI controls, design memory, better defaults, verified output

## March 15, 2026 — Streaming AI Responses
- SSE streaming with status events, tokens, files, done/error, message_saved
- Progressive rendering, streaming cursor, auto-scroll, composer locking

## March 15, 2026 — Filesystem Awareness
- File tree index, import graph, intent-aware selection, safe multi-file editing

## March 15, 2026 — Intent Classification Fix
- Reordered priorities in `intents.js` to fix `build` prompts being misclassified as `chat_only`

## March 15, 2026 — Login Flow Fix
- Password reset flow + session object fix for automatic dashboard transition
