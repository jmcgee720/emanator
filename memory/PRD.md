# Emanator — AI Self-Builder

## Problem Statement
Import GitHub repo, run the Next.js AI builder, harden (A-G), implement design system (H).
Premium futuristic "AI engine" design with 3D aurora borealis S-curve depth effect.

## Architecture
- Next.js 14 App Router (port 3000, supervisor: `nextjs_api`)
- FastAPI reverse proxy (port 8001 -> 3000)
- Supabase (Postgres + RLS)

## Completed Phases
- **A-G5**: Plan validation, Workspaces, Memory, Routing, Multi-Pass, Self-Critique, Autonomous Execution
- **G6**: Session Forking
- **H1-H5**: Moodboard, Token System, Shell Refactor, Motion Layer, Login alignment
- **H10**: Aurora Borealis — Sky-Dome Crown
- **Glass H7.1**: Premium glass — clear glass, no purple tint
- **Project Bin Rebuild**: Hero prompt, mode toggles, floating glass cards
- **Glass Style Unification** (Mar 2026)
- **Aurora Ceiling Geometry Correction** (Feb 2026)
- **Aurora Z-Depth Simulation** (Feb 2026): Added depth zones with varying blur/size
- **Aurora Y-Axis Shift** (Feb 2026): Shifted columns higher so bright bottom edges are closest
- **Aurora Asymmetric S-Curve** (Feb 2026)
- **H7.4: Project / Chat Deletion** (Mar 2026):
  - Part 1: Project Bin Delete — trash icon on project cards (hover), confirmation modal with cascade info
  - Part 2: Account Cleanup — "Delete All" button + "Delete Everything" modal with strong warning
  - Part 3: Safety — all deletes require confirmation, optimistic UI removal, clean error toasts
  - Backend: `DELETE /api/projects/:id` (with ownership verification), `POST /api/account/cleanup` (bulk)
  - Supabase ON DELETE CASCADE handles chats, messages, files, canvas, generation_runs, memory, changelog
- **H7.5: Project Workspace Hub** (Mar 2026):
  - New intermediate view between Project Bin (grid) and chat workspace
  - 3-panel layout: Left (chat navigation), Center (project overview + quick actions), Right (project details/metadata)
  - Flow: Project Bin → Hub → Chat workspace (with back-navigation at each level)
  - Workspace tabs: breadcrumb-style "← Projects" | "Project Name" (hub) | "Chat Title"
  - Quick actions: Open Latest Chat, New Chat, Import Files, Pull Latest (placeholder)
  - Right panel: file count, conversation count, last updated, framework, credits, delete action
  - File: `/app/components/dashboard/ProjectHub.jsx`
  - Bug fix: Hero prompt submit button was non-functional (only triggered aurora animation). Wired `handleHeroPromptSubmit` to create project, added Enter key handler, disabled state when empty/submitting.
- **H8.2: GitHub Import (PAT)** (Mar 2026) — COMPLETE
  - Import UI, backend, branch resolution, response parsing, repo normalization, import button scope fix
  - Verified: button works from all views, repo parsing, branch resolution, project+files created
- **Aurora UI Polish** (Mar 2026): Dimmed dashboard variant, desynchronized veil animations
- **Hero Prompt Fix** (Mar 2026): Wired submit, Enter key, voice dictation, messagesReadyTick handoff
- **BUILD Intent Streaming Fix** (Mar 2026):
  - Fixed SelfCritique loop: replaced `continue` (wrong loop scope) with inline AI re-call
  - Fixed PlanValidator rejection: replaced `continue` (wrong loop scope) with inline AI retry
  - Both fixes ensure rejected/revised plans properly re-call the AI and yield tokens to client
- **Anthropic Provider Fix** (Mar 2026):
  - Root cause: Health check misclassified Anthropic billing error (HTTP 400 "credit balance too low") as `auth_issue` because `msg.includes('invalid')` matched `"invalid_request_error"` in the error JSON
  - Fix 1: `route.js` — Reordered health-check conditions so billing/credit is checked before `invalid` keyword; narrowed auth check to `invalid api key`/`invalid x-api-key`
  - Fix 2: `ModelSelector.jsx` — Made `billing_issue` selectable (not disabled) since the key IS valid, just low on credits
- **H8.1: Stripe Integration** (Mar 2026) — COMPLETE
  - Checkout, status polling, webhook, credit packages, idempotent payments

## Preview Execution System (Mar 2026) — COMPLETE
- **Root cause of limitation**: PreviewTab.jsx only assembled file contents into iframe `srcDoc` via Babel — no mechanism to run `npm install`/`npm start` for Node.js projects
- **Backend endpoints** (server.py):
  - `POST /api/preview/start` — Receives project_id + files array, writes to `/tmp/preview_{id}/`, detects type (package.json → Node, index.html → static), starts process on ports 9000-9100
  - `GET /api/preview/status/{project_id}` — Returns status (installing/running/failed/stopped), type, port, last 100 log lines
  - `POST /api/preview/stop/{project_id}` — Kills process, cleans up temp directory
  - `GET /api/preview/serve/{project_id}/{path}` — Proxies all HTTP requests to the running preview process port
- **Node.js execution**: Parses package.json scripts → `npm install --no-audit --no-fund && npm run dev/start`, sets PORT env var, captures stdout/stderr in deque buffer, background thread monitors output for "ready" indicators
- **Static HTML execution**: Serves via `python3 -m http.server` on assigned port
- **Concurrency**: Max 1 concurrent preview enforced (new start stops old)
- **Frontend** (PreviewTab.jsx):
  - `classifyProject()` detects 'node' type when files include `package.json`
  - `NodePreviewRunner` component: Start Preview button → POST files → poll status → show build logs → embed iframe when running → Stop button
  - Framework label detection: reads package.json deps to show Next.js/CRA/Vite/Express/React
  - Core system projects remain blocked from self-preview
  - Static HTML/React/JS projects continue using existing srcdoc mechanism
- **Manual preview flow**: User clicks "Start Preview" → files sent to backend → npm install → dev server starts → iframe loads proxied URL → build logs shown → user can stop/restart
- Tested: 14/14 backend tests passed (pytest), frontend verified via Playwright

## Design Rules
- Glass: see-through frosted, white tint bg, blur 28px, saturate 1.5
- Aurora: Asymmetric S-curve depth flow, NOT symmetric horseshoe
- Aurora geometry: left=foreground (close, large, sharp), right=background (far, small, blurry)
- Aurora depth zones: CLOSE (left, blur=2px), MID (center, blur=5px), FAR (right, blur=10px)
- Aurora color: cyan columns below, violet/magenta columns above, per depth zone
- Aurora motion: sideways drifting, folding, rippling (sway, drift, float animations)
- Background: dark navy #0C1018
- Text Primary: `#FFFFFF`, Secondary: `#C0C4D8`, Muted: `#8A8EA6`

## Key Files
- `/app/app/globals.css` — Aurora engine (S-curve geometry) + Glass system + Tokens
- `/app/components/dashboard/Dashboard.jsx` — Project Bin + hero + modals + aurora state + delete flows + hub routing
- `/app/components/dashboard/ProjectHub.jsx` — 3-panel workspace hub (chat nav, overview, details)
- `/app/components/dashboard/TopBar.jsx` — Logo, credits, import, search, intensity
- `/app/components/dashboard/tabs/PreviewTab.jsx` — Preview execution system (Node runner + static + srcdoc)
- `/app/components/auth/LoginPage.jsx` — Login + Google OAuth + glass
- `/app/hooks/useAuroraState.js` — Aurora state machine hook
- `/app/app/api/[[...path]]/route.js` — API routes (project CRUD, delete, account cleanup, GitHub import)
- `/app/lib/ai/service.js` — AI pipeline (multi-pass, plan mode, self-critique, streaming)
- `/app/lib/api/stream-handler.js` — SSE streaming endpoint handler
- `/app/backend/server.py` — FastAPI reverse proxy, Stripe, Growth, Preview runner

## Backlog
- **P1 DONE: Aurora Design Tokens on Core UI** (Mar 2026):
  - Applied `em-input` to ChatComposer textarea and SearchPanel search input
  - Applied `em-btn-ghost` glass-morphism to ModelSelector trigger button
  - Applied `em-elevated-interactive` to SearchPanel result cards
  - Applied glass panel treatment (em-panel bg, backdrop-blur, violet borders, deep shadows) to SearchPanel
  - Files changed: `ChatComposer.jsx`, `ModelSelector.jsx`, `SearchPanel.jsx`
- **Workspace Redirect Flicker Fix** (Mar 2026):
  - Changed project tile click to land on ProjectHub (hubEntryRef=true → skipChatSelect=true)
  - Changed GitHub import to land on ProjectHub (same mechanism)
  - Removed projectSwitchingRef guard (no longer needed)
  - Tile click → ProjectHub; Open Workspace / conversation click → Workspace
  - File: Dashboard.jsx (5 lines changed)
- **Core System Entry Fix** (Mar 2026):
  - Added `hubEntryRef=true` + `setSelectedChat(null)` + `setMessages([])` before `openProjectWorkspace(coreProject)`
  - Core System now opens ProjectHub without auto-selecting "Emanator Backend" chat
  - File: Dashboard.jsx
- **Site Map Visualization** (Mar 2026):
  - Added List/Map toggle to Growth panel sidebar
  - Map view shows tree hierarchy built from `parent_seed_url` relationship data
  - Root nodes (seed pages) with violet icon, child count badge
  - Child nodes indented with CSS connector lines, path-only labels
  - Clicking any node syncs with the existing page detail panel
  - SiteMapTree component (100 lines) added to GrowthPanel.jsx
  - Also refactored page selection into shared `selectPage` helper
- **Debug Cleanup** (Mar 2026):
  - Removed 2 diagnostic console.logs and 1 visible "Resolved Preview URL" debug banner from PreviewTab.jsx
- **Real-time Batch Crawl Progress** (Mar 2026):
  - Backend: `_crawl_progress` dict updated per-page in BFS loop, GET `/api/internal/growth/crawl/progress` endpoint
  - Route proxy: `/growth/crawl/progress` GET added in route.js
  - Frontend: 1.5s poll during batch crawl, progress banner with spinner, X/Y counter, cyan progress bar, saved count, current URL
  - Auto-clears on completion, replaced by existing "Batch Crawl Complete" summary
  - Files: server.py, route.js, GrowthPanel.jsx
- **Bulk Analyze ("Analyze All")** (Mar 2026):
  - "Analyze All (N unanalyzed)" button appears when 2+ pages exist with unanalyzed pages
  - Iterates sequentially through unanalyzed pages, calling existing single-page analyze endpoint
  - Violet progress banner with spinner, X/Y counter, progress bar, current page title
  - Respects persona selection (uses selectedPersonaId if set)
  - Auto-refreshes pages list on completion; single-page analyze unchanged
  - File: GrowthPanel.jsx only (no backend changes)
- **Export Crawl Data** (Mar 2026):
  - "Export" button in Growth header bar (next to page count)
  - Downloads `growth-export-YYYY-MM-DD.json` with full page data: extracted data, analysis/opportunities, fixes, marketing drafts, hierarchy relationships
  - Backend: `getAllPagesFull()` in service.js (one query, no projection), `/growth/pages/export` GET route in route.js
  - Files: service.js, route.js, GrowthPanel.jsx
- **AI Bot Persona Update** (Mar 2026): Changed system prompt to casual peer-developer tone. No more formal consultant language. File: `lib/ai/context.js`
- **Hero Prompt Title Fix** (Mar 2026): Hero prompt now creates projects named "New Project" instead of using raw prompt text as title. File: `Dashboard.jsx`
- **ProjectHub UI Cleanup** (Mar 2026):
  - Tech badge: "node" now displays as "Node.js"
  - Removed Credits section from right details panel
  - Reduced emphasis on "Created X ago" secondary text (smaller size, lower opacity, tighter spacing)
  - Normalized quick action card icons (w-8 h-8 containers, w-3.5 h-3.5 icons), consistent Aurora glass hover (cyan border, subtle lift + glow)
  - Style-only; no logic changes. File: `ProjectHub.jsx`
- P2: Refactor `lib/ai/service.js` (~2700 lines) into smaller modules
- P2: Refactor `app/api/[[...path]]/route.js` (~4000+ lines) into smaller modules
- P3: GitHub OAuth (deferred in favor of PAT)
- P3: Deploy integration (Vercel/Netlify) — Phase 2, currently mocked

## Deploy Tab Placeholder (Mar 2026)
- Deploy is Phase 2 — not part of current acceptance
- Endpoints return safe stubs (GET `[]`, POST 501)
- UI: Deploy button disabled, labeled "Not Yet Available"
