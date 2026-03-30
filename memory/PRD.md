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
- **H7.6: GitHub Repository Import — PAT-based** (Mar 2026):
  - Part 1: Import UI — "Import from GitHub" in modal with PAT, repo (owner/repo), branch fields
  - Part 2: Backend `POST /api/import/github` fetches repo tree via GitHub REST API, filters node_modules/.git/build
  - Part 3: Reuses ZIP pipeline — framework detection, file type detection, project creation, canvas, initial chat
  - Part 4: Stores repo_url, branch, last_commit_sha in project.settings for sync
  - Part 5: `POST /api/import/github/sync` — Pull Latest compares SHA, upserts changed files
  - ProjectHub "Pull Latest" button active for GitHub-imported projects, disabled for others
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
- **H8.1: Stripe Integration** (Mar 2026):
  - Server: `POST /api/stripe/checkout` (creates Stripe Checkout session via `emergentintegrations`)
  - Server: `GET /api/stripe/status/{session_id}` (polls payment, grants credits idempotently)
  - Server: `POST /api/webhook/stripe` (handles `checkout.session.completed`, grants credits)
  - Packages: starter ($10→100), pro ($45→500), ultra ($80→1000)
  - Idempotent: `payment_transactions` collection with unique `session_id` index, `$ne: 'paid'` guard
  - Frontend: Credits modal buttons redirect to Stripe Checkout, return polling confirms payment
- **GitHub Import Branch Resolution Fix** (Mar 2026):
  - Root cause (import): Old code passed branch name directly to `/git/commits/{branch}` which expects a 40-char SHA
  - Fix (import): Added `/branches/{name}` API call to resolve branch name → commit SHA before tree fetch; falls back to repo default branch on 404
  - Root cause (sync): `commitData` referenced on tree fetch line but only defined in SHA else-block; undefined for branch names
  - Fix (sync): Replaced `commitData.commit.tree.sha` with `syncTreeSha` variable that's set in both code paths
  - Files changed: `app/api/[[...path]]/route.js`
- **GitHub Import Response Parsing Fix** (Mar 2026):
  - Root cause: Frontend called `res.json()` unconditionally; upstream timeouts (Cloudflare/ingress) return HTML error pages, causing `JSON.parse` failure
  - Fix 1 (frontend): Read response as text first, safe-parse with `JSON.parse`, surface raw text on failure instead of cryptic parse error
  - Fix 2 (proxy): `server.py` proxy wraps non-JSON upstream responses in JSON error objects; catches `response.json()` failures gracefully
  - Applied to both import and sync handlers in `Dashboard.jsx`
  - Files changed: `components/dashboard/Dashboard.jsx`, `backend/server.py`
- **GitHub Import Repo Parsing Normalization** (Mar 2026):
  - Root cause: Backend only accepted `owner/repo` format; error handler returned generic "Branch not found" without the actual GitHub API error message, masking auth/permission issues (e.g., 403)
  - Fix 1 (backend): Added repo normalization — strips `.git`, trailing slash, extracts `owner/repo` from full GitHub URLs
  - Fix 2 (backend): Error handler now surfaces actual GitHub API error message instead of generic "Branch not found"
  - Fix 3 (frontend): Relaxed validation regex to accept both `owner/repo` and `https://github.com/owner/repo` formats
  - Files changed: `app/api/[[...path]]/route.js`, `components/dashboard/Dashboard.jsx`

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
- `/app/components/auth/LoginPage.jsx` — Login + Google OAuth + glass
- `/app/hooks/useAuroraState.js` — Aurora state machine hook
- `/app/app/api/[[...path]]/route.js` — API routes (project CRUD, delete, account cleanup, GitHub import)
- `/app/lib/ai/service.js` — AI pipeline (multi-pass, plan mode, self-critique, streaming)
- `/app/lib/api/stream-handler.js` — SSE streaming endpoint handler
- `/app/backend/server.py` — FastAPI reverse proxy & Stripe endpoints

## Backlog
- P0: Growth Engine UI (GrowthPanel component wired to Dashboard)
- P1: Apply design tokens to ChatComposer, ModelSelector, SearchPanel
- P2: Refactor `lib/ai/service.js` (~2700 lines) into smaller modules
- P3: GitHub OAuth (deferred in favor of PAT)

## Growth Engine MVP v1 — Backend + API (Mar 2026)
- `POST /api/growth/crawl` (FastAPI): Accepts `{ url }`, normalizes URL, fetches HTML with 10s timeout, extracts SEO data via BeautifulSoup (title, meta, headings, word count, links, images, OG tags, canonical, robots), stores in MongoDB `growth_pages` with `user_id` from JWT
- `POST /api/growth/analyze` (FastAPI): Accepts `{ page_id }`, fetches stored page, sends extracted data to GPT-4o via Emergent LLM Key (LlmChat), returns structured opportunities `{ title_issues, meta_issues, content_issues, structure_issues, recommendations }`, stores result in MongoDB
- `GET /api/growth/pages` (Next.js route.js): Lists user's crawled pages with auth (getAuthUser + checkAllowlist), uses `authUser.id` (Supabase auth UUID) to match MongoDB `user_id`
- `GET /api/growth/pages/:id` (Next.js route.js): Returns single page with full extracted_data + opportunities, ownership enforced
- `DELETE /api/growth/pages/:id` (Next.js route.js): Deletes page, ownership enforced
- MongoDB service: `lib/growth/service.js` — savePage, getPages, getPage, saveOpportunities, deletePage
- Key detail: `user_id` uses Supabase `public.users.id` (via `dbUser.id`), matching all other features (projects, credits). Python endpoints are internal-only at `/api/internal/growth/*`, called by Next.js route.js which handles auth.
- **Growth Engine UI Shell** (Mar 2026):
  - `GrowthPanel.jsx`: Full-view panel (AdminPanel pattern) with left sidebar (URL input, crawl button, pages list) and right detail area (extracted data summary, meta details, SEO opportunities)
  - TopBar: Added "Growth" button with BarChart3 icon
  - Dashboard: `showGrowth` state, early return for GrowthPanel
  - Features: crawl URL, list pages, view page detail, run AI analysis, view structured SEO opportunities (5 sections), delete pages, back navigation
  - Loading/empty/error states for all async operations
  - Files: `components/dashboard/GrowthPanel.jsx` (created), `Dashboard.jsx` (updated), `TopBar.jsx` (updated)
