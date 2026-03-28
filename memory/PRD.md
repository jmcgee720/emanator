# Emanator — AI Self-Builder

## Problem Statement
Import GitHub repo, run the Next.js AI builder, harden (A-G), implement design system (H).

## Architecture
- Next.js 14 App Router (port 3000, supervisor: `nextjs_api`)
- FastAPI reverse proxy (port 8001 -> 3000)
- Supabase (Postgres + RLS)

## Completed Phases
- **A-G5**: Plan validation, Workspaces, Memory, Routing, Multi-Pass, Self-Critique, Autonomous Execution
- **G6**: Session Forking
- **H1-H5**: Moodboard, Token System, Shell Refactor, Motion Layer, Login alignment
- **H10**: Aurora Borealis — Sky-Dome Crown (top-origin perspective, radial ribbons, skewX wave)
- **Glass H7.1**: Premium glass — clear glass, no purple tint, neutral cool tone
- **Project Bin Rebuild**: Hero prompt, mode toggles, floating glass cards on aurora, credits/import UI
- **Visual Correction Pass** (Mar 2026):
- **Glass Style Unification** (Mar 2026):
  - ALL glass elements (login, topbar, sidebar, project cards, prompt bar, modals) now use see-through frosted glass
  - Replaced opaque dark fills with white-tint transparent backgrounds
  - Added specular edge shimmers (top/left/right/bottom) and diagonal refraction gradients
  - Unified button styles: glass ghost buttons (white border) and brand gradient buttons
  - Removed all violet/purple border references, replaced with neutral white glass borders
  - Text Crispness Pass: Primary `#FFFFFF`, Secondary `#C0C4D8`, Muted `#8A8EA6`

## Design Rules (Phase H5 LOCKED)
- Glass: see-through frosted, white tint bg `rgba(255,255,255, 0.03-0.06)`, blur 28px, saturate 1.5
- Hero input: higher glass clarity than cards (0.09 tint, blur 36px, stronger specular)
- Glass panels MUST be see-through — aurora visible through them
- Specular: crisp 1px top-edge shimmer (0.60 peak white + cyan accent)
- Vertical reflection gradient on cards (::after — light top, dark bottom)
- Card hover: -translate-y-0.5 lift + glow intensify, no harsh scale
- Borders: `rgba(255,255,255, 0.14)`, hover to 0.24
- Buttons: glass ghost (white border, backdrop-blur) or brand gradient (purple-magenta)
- Headlines: 24 inspirational lines, random on load (inlined in Dashboard.jsx)
- Core System button: glass ghost style with teal/cyan text
- Aurora: TOP-ORIGIN dome with behavior layer (idle/typing/planning/applying/error states)
- Aurora energy flow: directional surge L→C→R on submit (1.8s)
- Aurora rays: intermittent vertical filaments (6-14s random interval)
- Background: dark navy #0C1018
- Text Primary: `#FFFFFF`, Secondary: `#C0C4D8`, Muted: `#8A8EA6` — crisp, NOT ghosted

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine + Glass system + Intensity modifiers
- `/app/components/dashboard/Dashboard.jsx` — Project Bin + hero + headlines + modals + aurora state + credits
- `/app/components/dashboard/TopBar.jsx` — Logo, credits balance, import, search, aurora intensity, user menu
- `/app/components/auth/LoginPage.jsx` — Login + Google OAuth + clear glass + aurora
- `/app/app/page.js` — Auth flow with OAuth provider detection
- `/app/app/auth/callback/route.js` — OAuth callback handler
- `/app/hooks/useAuroraState.js` — Aurora intensity, boost, state mode hook
- `/app/lib/credits/service.js` — Credits MongoDB service (balance, deduct, add, usage history)
- `/app/lib/credits/config.js` — Credit cost model and packages

## Backlog
- P2: ChatComposer, ModelSelector, SearchPanel token pass
- P2: Refactor `lib/ai/service.js`
- P3: GitHub repository import (Connect Repository)
- P3: Credits persistence via Stripe/payment integration
