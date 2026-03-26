# MyMergent - Private AI Builder Platform

## Product Overview
An internal, approval-based AI platform for generating websites, web apps, product specs, UI screens, images, and code files. Built with Next.js 14, Supabase (Auth + PostgreSQL), OpenAI + Anthropic, and shadcn/ui.

## Tech Stack
- **Frontend:** Next.js 14 (App Router), React 18, Tailwind CSS, shadcn/ui, lucide-react
- **Backend:** Next.js API Routes (catch-all at `/api/[[...path]]`)
- **Database:** Supabase PostgreSQL
- **Auth:** Supabase Auth — dual strategy: cookie-based SSR + bearer token fallback
- **AI:** OpenAI SDK, Anthropic SDK

## What's Implemented

### Authentication
- [x] Dual auth strategy, auth-aware fetch, session hydration, embedded mode

### AI Engine
- [x] Multi-provider AI (OpenAI + Anthropic) with streaming (SSE)
- [x] Intent classifier (12 intents) + workflow routing
- [x] Scope-aware context routing
- [x] Full Filesystem Awareness (tree index, import graph, intent-aware selection)
- [x] **Design Intelligence System** (Implemented March 15, 2026)

### Design Intelligence (9 Parts)
- [x] All 9 parts implemented: presets, tokens, layout intelligence, component patterns, AI prompt injection, UI controls, design memory, better defaults, verified output

### Streaming System
- [x] SSE with status events, tokens, files, done/error, message_saved
- [x] Progressive rendering, streaming cursor, auto-scroll, composer locking

### Filesystem Awareness
- [x] File tree index, import graph, intent-aware selection, safe multi-file editing

### UI
- [x] Split-screen dashboard, model/scope selectors, intent badges
- [x] Canvas Panel, Preview Tab, Logs Tab
- [x] Design Intelligence Panel

### File Upload in Chat
- [x] Upload UI, supported types, size limits, storage, AI context injection, message display, validation

### Diff / Patch Review Mode
- [x] Diff generation, DiffReviewPanel UI, apply controls, snapshot before apply, file change logging, selective apply, state persistence

### Plan → Execute Mode
- [x] Plan stage, Plan Card UI, Execute/Revise/Cancel controls, plan persistence, non-plan bypass, execution streaming

### Image & Sprite Generation
- [x] Intent routing, broad patterns, image pipeline, GeneratedImageCard, Assets tab, sprite workflow, follow-up/variation support, asset management

### Variation Studio
- [x] Full variation modal, style control refactor, quick style actions, non-blocking UX, GeneratedImageCard actions, assets tab upgrades, asset relationships

### Prompt Library + Adaptive Learning
- [x] Prompt library CRUD, user/project preferences, correction learning, adaptive context injection, prompt run tracking, Builder Memory UI, provider routing, 11 API endpoints
- [x] Correction Learning, Project-Specific Memory Scoping, User Preference Memory

### Grounded Planning
- [x] FileContextLoader, PlanValidator, ChangeLog, Tool Schema, Backend Integration, Frontend PlanCard, E2E Pipeline Verified

### Pipeline Hardening
- [x] Duplicate-Plan Loop Breaker, Patch Grounding Validator, Diff Review Guard, Task-Mode Enforcement

### Request-Mode Gate
- [x] classifyRequestMode(), validateRequestModeOutput(), Planner bypass paths, read_only_report, Mode-mismatch logging

### Stale Plan/Diff ID Enforcement
- [x] planId + diffId generation, persistence, DiffReviewGuard ID checks, Post-apply status

### Self-Builder Pipeline (Phase 2)
- [x] `lib/self_builder/` modules: request_router, feature_planner, file_ops_bridge, safe_apply, change_log
- [x] 4 proof tests passed (Phase 9)

### Role System (Phase 7)
- [x] 3-role system: owner/admin/member
- [x] Permission checks: self_edit, manage_users, manage_content, execute_plan, view_admin

### Core System Boundary (Phase 6)
- [x] Self-edit chats separated, owner-only access, UI separation, amber visual language

### User Dashboard + Audit Log Viewer (March 19, 2026)
- [x] **User Dashboard**: Lists all users with email, effective role, created_at, last_seen (from Supabase Auth last_sign_in_at)
- [x] **Audit Log Viewer**: Unified activity feed from changelog + file_change_events — shows plan execution, diff apply/discard, self-edit chat creation, role changes, file operations
- [x] **Permissions**: owner → full access (add/edit/delete users), admin → read-only view, member → no access
- [x] **TopBar access**: Admin link visible to both owner and admin roles via `hasPermission(role, 'view_admin')`
- [x] **Backend**: GET /api/admin/users (enriched with last_seen), GET /api/admin/activity (unified feed, 100 events max)
- [x] **Tested**: Backend 5/5, Frontend 5/5 — iteration_10.json, iteration_11.json

### Child_Monitored Role + Monitored Account Mode (March 19, 2026)
- [x] **New role**: `child_monitored` added to ROLES, VALID_ROLES, getUserRole, hasPermission
- [x] **Permissions**: child_monitored can use builder chats, blocked from self-edit + admin. New `view_monitored` permission (owner only). New `isMonitored()` helper.
- [x] **Backend enforcement**: checkAllowlist resolves child_monitored from Supabase Auth metadata. Create/update/enrich users with child_monitored role. Self-edit blocking for monitored users on streaming + non-streaming endpoints.
- [x] **Monitoring capture**: Monitored-user prompts logged to changelog as `task_mode: 'monitored_prompt'` — reuses existing infrastructure, no new tables.
- [x] **New endpoint**: GET /api/admin/monitored — owner-only feed of monitored-user activity (prompts + actions filtered by child_monitored actors).
- [x] **UI**: Monitored badge (rose) on user rows, "Monitored" tab in AdminPanel (owner only), role selector includes "Monitored" option.
- [x] **Tested**: Backend 7/7 (iteration_12.json), Frontend 5/6 (iteration_13.json — badge timing issue in automation only, data verified correct)

## Key Files

### User Dashboard + Audit Log
- `/app/components/dashboard/AdminPanel.jsx` — Users tab + Activity tab UI
- `/app/components/dashboard/TopBar.jsx` — Admin link for owner + admin
- `/app/app/api/[[...path]]/route.js` — GET /api/admin/users, GET /api/admin/activity

### AI Engine
- `/app/lib/ai/service.js` — AIService with design context injection + image generation
- `/app/lib/ai/intents.js` — Intent classifier (13 intents)
- `/app/lib/ai/image-service.js` — Image generation with variation support

### API
- `/app/app/api/[[...path]]/route.js` — All routes

### Versioned Self-Modification — Sandbox / Workspace Clone (March 19, 2026)
- [x] **Sandbox creation**: `POST /api/projects/:id/sandbox` clones project + all files into an isolated sandbox project
- [x] **Metadata**: `settings.is_sandbox`, `sandbox_source_id`, `sandbox_status`, `sandbox_created_by` stored in project settings (zero schema changes)
- [x] **File cloning**: All `project_files` bulk-cloned via `db.projectFiles.bulkInsert`
- [x] **Isolation**: Sandbox chats/files/diffs operate independently from source. No automatic promotion to primary.
- [x] **UI**: Flask icon + amber "sandbox" badge in project selector, "Sandbox Mode" banner when active, "Create Sandbox" action in dropdown (owner only)
- [x] **Changelog**: Sandbox creation logged as `task_mode: 'sandbox_create'`
- [x] **Tested**: Backend 7/7 (iteration_14.json), Frontend 5/5 (iteration_15.json)

### Test-Before-Apply Validation Gate (March 19, 2026)
- [x] **Endpoint**: `POST /api/projects/:id/test-before-apply` — sandbox-only validation gate
- [x] **Checks**: sandbox_status (active), diff_exists (non-empty), syntax (JSON parse, JS brace/paren/bracket balance), imports (resolution against project files)
- [x] **Output**: `{ passed, errors[], checks[], timestamp, files_tested }` — stored in `settings.last_test_result`
- [x] **UI**: "Test Changes" button in sandbox banner, PASS/FAIL badge with error count, toast notifications
- [x] **Safety**: Fails keep changes isolated, no auto-promotion, existing flows preserved
- [x] **Tested**: Backend 10/10 (iteration_16.json), Frontend verified via live screenshot + code analysis (iteration_17.json)

### Promote Sandbox → Primary (March 19, 2026)
- [x] **Endpoint**: `POST /api/projects/:id/promote` — owner-only, sandbox-only
- [x] **Preconditions enforced**: `is_sandbox === true`, `sandbox_status === 'active'`, `last_test_result.passed === true`, sandbox has files
- [x] **Behavior**: Deletes source project files → copies sandbox files to source. Sandbox remains as read-only snapshot.
- [x] **Metadata**: `sandbox_status = 'promoted'`, `promoted_at` timestamp stored in settings
- [x] **Changelog**: Promotion event logged as `task_mode: 'sandbox_promote'` with actor, source/target IDs
- [x] **UI**: "Promote to Primary" button visible only when owner + test passed + status active. Confirmation dialog before promotion. "PROMOTED" badge after success. Post-promotion banner shows "read-only snapshot" text.
- [x] **Safety**: Double-promote blocked, non-sandbox blocked, no auto-promotion, no overwrite without validation
- [x] **Tested**: Backend 13/13 (iteration_18.json), Frontend verified via live screenshot

### Diff Sandbox vs Primary (March 19, 2026)
- [x] **Endpoint**: `GET /api/projects/:id/sandbox-diff` — owner-only, sandbox-only, read-only
- [x] **Output**: `{ sandbox_id, source_id, total_changes, summary: { created, updated, deleted }, changes: [{ path, status, lines_added, lines_removed }] }`
- [x] **Statuses**: `create` (new in sandbox), `update` (content differs), `delete` (removed from sandbox)
- [x] **Line counting**: Simple set-based diff for added/removed line counts
- [x] **UI**: Blue "View Diff" button in sandbox banner, overlay panel with file list, color-coded status badges (NEW/MOD/DEL), summary header, empty state
- [x] **Safety**: Read-only — does not mutate sandbox or primary
- [x] **Bugfix**: Sandbox creation no longer inherits stale `last_test_result` from source settings
- [x] **Tested**: Backend 11/11 (iteration_19.json), Frontend verified via live screenshot

### Rollback Promotion (March 19, 2026)
- [x] **Snapshot capture**: Before overwriting primary files during promote, captures `{ path, previous_content, existed_before }` for every affected file; stored in changelog `file_actions.snapshot`
- [x] **Rollback endpoint**: `POST /api/projects/:id/rollback` — owner-only, sandbox must be in `promoted` status. Finds promotion snapshot from changelog, deletes current primary files, restores `existed_before=true` files, removes `existed_before=false` files (sandbox-only creations)
- [x] **Status tracking**: Sandbox marked `sandbox_status='rolled_back'` + `rolled_back_at` timestamp
- [x] **Logging**: Rollback event logged as `task_mode: 'sandbox_rollback'` with file counts
- [x] **Guards**: Double-rollback blocked, non-promoted blocked, non-sandbox blocked, auth enforced
- [x] **UI**: Red "Rollback" button appears next to PROMOTED badge (owner only), confirmation dialog, ROLLED BACK badge, banner text updates per state, action buttons hidden after promote/rollback
- [x] **Tested**: Backend 16/16 (iteration_20.json)

### Intent Classification Routing Fix (March 19, 2026)
- [x] **Root cause**: Code/architecture prompts (e.g. "Implement rollback", "Modify route.js") were misclassified as image intents because `image_generation` patterns had higher priority than `build` in INTENT_PRIORITY, and CODE_BUILD_SIGNALS lacked file/architecture terms
- [x] **Fix 1 — `lib/ai/intents.js`**: Extended `CODE_BUILD_SIGNALS` with file extensions (`.js/.jsx/.ts/.tsx`), specific filenames (`route.js`, `Dashboard.jsx`), code paths (`lib/`, `app/`, `components/`), architecture terms (`rollback`, `sandbox`, `pipeline`, `diff`, `changelog`, `file_actions`, `validator`, `planner`), UI terms (`dashboard`, `sidebar`, `panel`). Added `codeOverridesAsset` logic so code signals override `ASSET_OBJECT_PATTERNS` (fixes "generate a graphic showing the architecture")
- [x] **Fix 2 — `lib/ai/service.js`**: Hard guard in `processImageGeneration()` blocks image generation when code signals detected in prompt
- [x] **Verified**: 12/12 code prompts → CODE, 7/7 image prompts → IMAGE, 1/1 streaming SSE test passed (iteration_21.json)

## Pending / Upcoming

### P0 — Stability (Phase 1)
- [ ] Ensure correct file action labeling (~ vs +)
- [ ] Ensure single-file edit prompts stay single-file

### P1 — Builder Memory Panel (Phase 3)
- [ ] Show stored memory entries in panel sections
- [ ] Add sections: Saved Prompt Patterns, User Preferences, Project Rules, Self-Builder Status

### P2+ — Future
- Phase 5: Image/Asset Intelligence
- Phase 8: Versioned Self-Modification (version manager, sandbox, test-before-apply)

## Test Credentials
- `testprov@test.com` / `password123` — Owner role
