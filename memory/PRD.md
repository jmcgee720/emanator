# Emanator PRD

## Product Vision
Emanator is a conversational AI website builder that generates premium, visually stunning websites through natural language conversation. It features real-time live preview, AI-powered image generation, and a Tailwind CSS design system.

## Core Requirements
- AI generates complete React websites from Creative Brief input
- Live Preview shows the site building in real-time during streaming
- Generated sites must use standard Tailwind CSS utility classes (no custom classes)
- AI image generation replaces stock photos with custom art-directed images
- System must handle context limits (max_tokens: 16384) gracefully
- Generated sites must be VISUALLY STUNNING on first build — gradient text, SVG logos, glassmorphism, glow effects

## Architecture
- **Framework**: Next.js 14 App Router
- **Preview**: srcdoc iframe with Babel inline transpilation + Tailwind CDN v3.4.17
- **AI**: OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key proxy
- **Images**: GPT Image 1 via Emergent LLM Key
- **DB**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Payments**: Stripe

## Key Files
- `/app/components/dashboard/tabs/PreviewTab.jsx` — Preview rendering, Babel transpilation, streaming shell
- `/app/lib/ai/message-stream.js` — Core AI orchestrator (~1900 lines)
- `/app/lib/ai/file-operations.js` — File saving, auto-repair, image post-processing
- `/app/lib/ai/prompt-builder.js` — Design recipes with code patterns
- `/app/lib/ai/design-system.js` — Premium dark default preset + design rules
- `/app/lib/ai/code-validator.js` — Truncation detection and auto-repair
- `/app/lib/ai/image-prefetch.js` — AI art direction and image generation

## What's Been Implemented
- [x] Conversational AI builder with streaming SSE
- [x] Live Preview iframe with Babel transpilation
- [x] Tailwind CSS rendering (pinned CDN v3.4.17, dark body default, forced rescan)
- [x] Streaming shell creation (valid empty shell for live builds)
- [x] AI image generation pipeline (placeholder → base64 via MutationObserver)
- [x] Premium design recipes in prompt-builder.js (8 mandatory code patterns)
- [x] Default premium_dark preset in design-system.js
- [x] Context explosion prevention (no base64 in DB/prompts)
- [x] Code truncation auto-repair
- [x] Preview skeleton loading state during builds
- [x] Regression guardrails (blank preview detection, auto-retry)
- [x] Smart isNodeProject detection
- [x] CRA entry file filtering
- [x] Stripe payments integration

## Completed This Session
### P0: Tailwind CSS Preview Rendering
- Pinned CDN to v3.4.17, dark body default, stripped @tailwind directives
- Fixed isNodeProject bypass, CRA entry filter, streaming shell creation
- Added Tailwind forced rescan after mount

### P0: Design Quality Overhaul
- Rewrote prompt-builder.js with 8 MANDATORY design recipes (SVG logo, glassmorphism navbar, gradient text, pill badge, glass cards, CTA glow, glow orbs, dark base)
- Changed default design preset from modern_saas (light) to premium_dark (dark)
- Added concrete code patterns the AI can copy-paste and adapt
- Made instructions concise and assertive instead of verbose
- Verified: AI now generates all 8 patterns on first build

### Bug Fix: "Create Failed"  
- Cleared stale SWC compilation cache that caused Fast Refresh full reloads

## Backlog
### P1
- **Image Pipeline Persistence** — Generated images (`__gen_img_X.png`) need to be stored/persisted so they survive page refreshes. Currently images are only available during the streaming build.
- **SVG Logo Quality** — The AI should generate brand-specific SVGs (arrows for Glass Arrow, leaves for nature brands) instead of generic icons
- Phase 3: Section Template Library
- Conversational AI phases 2-5

### P2
- Phase 4: Visual Quality Scoring
- Phase 5: Style Transfer
- Deploy integration (Vercel/Netlify)
- Refactor message-stream.js and service.js
- CSV export

## Known Issues
- Image generation timeout (20s) sometimes too aggressive
- Next.js memory thrashing / OOM (mitigated with supervisor restart)
- Generated images not persisted after build stream ends (P1)
