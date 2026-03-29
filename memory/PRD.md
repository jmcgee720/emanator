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
  - ProjectHub "Pull Latest" button active for GitHub-imported projects, disabled for others:
  - Replaced symmetric horseshoe with left-to-right S-curve depth flow
  - LEFT = foreground (large 3.6% wide, sharp blur=2px, low Y ~34%, bright opacity 0.72)
  - CENTER = mid-depth (medium 2.2-2.9%, blur=5px, Y ~22-30%, mid opacity)
  - RIGHT = background (small 0.8-1.7%, blur=10px, high Y ~7-17%, faded opacity 0.18-0.36)
  - S-curve Y path wiggles: 34→31→30→25→24→20→14→7%
  - Containment mask biased left-center (42% 24%) for asymmetric coverage
  - Ambient glow (veil 6) weighted toward foreground left

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
- `/app/app/api/[[...path]]/route.js` — API routes (project CRUD, delete, account cleanup)

## Backlog
- P1: Apply design tokens to ChatComposer, ModelSelector, SearchPanel
- P2: Refactor `lib/ai/service.js` (~2600 lines)
- P3: GitHub OAuth (deferred in favor of PAT)
- P3: Credits persistence via Stripe/payment integration
