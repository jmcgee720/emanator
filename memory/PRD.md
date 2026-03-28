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
- **H10**: Aurora Borealis — Sky-Dome Crown
- **Glass H7.1**: Premium glass — clear glass, no purple tint
- **Project Bin Rebuild**: Hero prompt, mode toggles, floating glass cards
- **Glass Style Unification** (Mar 2026)
- **Aurora Ceiling Geometry Correction** (Feb 2026):
  - Changed gradient direction from 180deg (vertical beams) to 90deg (horizontal arc bands)
  - Elements positioned above viewport: top -70% to -85%, height 170-210%
  - Background-size changed from narrow columns to full-width horizontal bands (100% x H%)
  - Increased rotateX to 38-44deg for overhead perspective, reduced perspective distance
  - Border-radius on bottom of elements for dome arc curvature
  - Containment mask centered at 28% from top (overhead dome feel)
  - Color blending: each band transitions cyan↔violet horizontally
  - 3 depth zones: TOP (compressed, thin, dim), MID (brightest, thickest), LOWER (soft fade)
  - Vertical fold mask (repeating-linear-gradient ~90-95deg) creates curtain fold texture within horizontal bands
  - Enhanced keyframes with skewX + translateX + scaleX for sideways drift/folding motion
  - New em-au-fold keyframe for intense near-layer deformation

## Design Rules
- Glass: see-through frosted, white tint bg, blur 28px, saturate 1.5
- Aurora: OVERHEAD CEILING perspective, horizontal arc bands, NOT vertical beams
- Aurora geometry: elements start above viewport, user sees lower portion
- Aurora depth: top=thin/dim/compressed, mid=bright/thick, bottom=soft fade
- Aurora curvature: border-radius + perspective for dome arc
- Aurora color: cyan↔violet BLEND within bands, not isolated stripes
- Aurora motion: sideways drifting, folding, rippling (skewX + translateX + scaleX)
- Aurora fold texture: vertical mask pattern for curtain-fold within horizontal bands
- Background: dark navy #050810-#080C18
- Text Primary: `#FFFFFF`, Secondary: `#C0C4D8`, Muted: `#8A8EA6`

## Key Files
- `/app/app/globals.css` — Aurora engine (ceiling geometry) + Glass system + Tokens
- `/app/components/dashboard/Dashboard.jsx` — Project Bin + hero + modals + aurora state
- `/app/components/dashboard/TopBar.jsx` — Logo, credits, import, search, intensity
- `/app/components/auth/LoginPage.jsx` — Login + Google OAuth + glass
- `/app/hooks/useAuroraState.js` — Aurora state machine hook

## Backlog
- P1: Apply design tokens to ChatComposer, ModelSelector, SearchPanel
- P2: Refactor `lib/ai/service.js` (~2600 lines)
- P3: GitHub repository import (Connect Repository)
- P3: Credits persistence via Stripe/payment integration
