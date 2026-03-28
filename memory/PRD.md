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
- **Visual Correction Pass** (Mar 2026)
- **Glass Style Unification** (Mar 2026)
- **Aurora Structural Correction** (Feb 2026):
  - Replaced radial-gradient "spotlight" shapes with linear-gradient vertical ribbon strips
  - Added mask-image (repeating-linear-gradient) on all ribbon layers for irregular edge breaking/filament texture
  - Each ribbon has unique width (background-size), height, position (background-position), and opacity (non-uniform)
  - Mid-body brightness: linear-gradient peaks at 50% height, NOT at top
  - Enhanced keyframes: em-au-curtain, em-au-wave, em-au-drift all include skewX + translateX + scaleX for horizontal wave deformation
  - New em-au-fold keyframe for intense near-layer deformation (veil-5)
  - Layer blending: all veils use mix-blend-mode: screen with overlapping ribbons at different animation speeds
  - Perspective maintained: rotateX + perspective combined with new deformation

## Design Rules (Phase H5 LOCKED)
- Glass: see-through frosted, white tint bg `rgba(255,255,255, 0.03-0.06)`, blur 28px, saturate 1.5
- Hero input: higher glass clarity than cards (0.09 tint, blur 36px, stronger specular)
- Glass panels MUST be see-through — aurora visible through them
- Specular: crisp 1px top-edge shimmer (0.60 peak white + cyan accent)
- Card hover: -translate-y-0.5 lift + glow intensify, no harsh scale
- Borders: `rgba(255,255,255, 0.14)`, hover to 0.24
- Buttons: glass ghost (white border, backdrop-blur) or brand gradient (purple-magenta)
- Aurora: flowing curtain ribbons, NOT spotlights. Linear-gradient strips + mask-image + wave deformation
- Aurora curtain structure: mid-body brightness, masked edges, non-uniform spacing
- Aurora keyframes: must include skewX(), translateX(), scaleX() for ripple/folding
- Background: dark navy #050810
- Text Primary: `#FFFFFF`, Secondary: `#C0C4D8`, Muted: `#8A8EA6`

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine (structural curtains) + Glass system + Intensity modifiers
- `/app/components/dashboard/Dashboard.jsx` — Project Bin + hero + headlines + modals + aurora state + credits
- `/app/components/dashboard/TopBar.jsx` — Logo, credits balance, import, search, aurora intensity, user menu
- `/app/components/auth/LoginPage.jsx` — Login + Google OAuth + clear glass + aurora
- `/app/hooks/useAuroraState.js` — Aurora intensity, boost, state mode hook

## Backlog
- P1: Apply design tokens to ChatComposer, ModelSelector, SearchPanel
- P2: Refactor `lib/ai/service.js` (~2600 lines)
- P3: GitHub repository import (Connect Repository)
- P3: Credits persistence via Stripe/payment integration
