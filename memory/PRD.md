# Emanator PRD

## Product Vision
Emanator is a conversational AI website builder that generates premium, visually stunning websites through natural language conversation. It features real-time live preview, AI-powered image generation, and a Tailwind CSS design system.

## Core Requirements
- AI generates complete React websites from Creative Brief input
- Live Preview shows the site building in real-time during streaming
- Generated sites must use standard Tailwind CSS utility classes (no custom classes)
- AI image generation replaces stock photos with custom art-directed images
- System must handle context limits (max_tokens: 16384) gracefully

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
- `/app/lib/ai/message-stream.js` — Core AI orchestrator (~1900 lines, needs refactoring)
- `/app/lib/ai/file-operations.js` — File saving, auto-repair, image post-processing
- `/app/lib/ai/prompt-builder.js` — System instructions for AI
- `/app/lib/ai/design-system.js` — Enforces standard Tailwind utility classes
- `/app/lib/ai/code-validator.js` — Truncation detection and auto-repair
- `/app/lib/ai/image-prefetch.js` — AI art direction and image generation
- `/app/components/dashboard/Dashboard.jsx` — State orchestrator

## What's Been Implemented
- [x] Conversational AI builder with streaming SSE
- [x] Live Preview iframe with Babel transpilation
- [x] Tailwind CSS rendering (pinned CDN v3.4.17, dark body default, forced rescan)
- [x] Streaming shell creation (valid empty shell for live builds)
- [x] AI image generation pipeline (placeholder → base64 via MutationObserver)
- [x] Design system enforcing standard Tailwind classes
- [x] Context explosion prevention (no base64 in DB/prompts)
- [x] Code truncation auto-repair
- [x] Preview skeleton loading state during builds
- [x] Regression guardrails (blank preview detection, auto-retry)
- [x] Smart isNodeProject detection (allows React preview for projects with package.json)
- [x] CRA entry file filtering (prevents competing React roots)
- [x] Stripe payments integration

## P0 Completed This Session
- Fixed Tailwind CSS rendering in Live Preview (was showing unstyled white-on-white)
  - Pinned Tailwind CDN to v3.4.17
  - Added dark body background default
  - Stripped @tailwind directives from CSS injection
  - Added forced Tailwind rescan after React mount
  - Fixed isNodeProject bypass for React projects with package.json
  - Added CRA entry file filter to prevent competing roots
  - Fixed streaming shell to return valid HTML for empty file arrays

## Backlog
### P1
- Verify AI Image Pipeline placeholder resolution end-to-end
- Complete Design Overhaul Phase 1 & 2 (prompt-builder.js, image-prefetch.js refinements)
- Phase 3: Section Template Library
- Conversational AI phases 2-5 (Intent Detection, Task Scope Classification, Silent Validation Retries, Learning System)
- CSV export

### P2
- Phase 4: Visual Quality Scoring
- Phase 5: Style Transfer (paste URL to copy visual DNA)
- Deploy integration (Vercel/Netlify)
- Refactor message-stream.js (~1900 lines) and service.js (~2600 lines)

## Known Issues
- Image generation timeout (20s) sometimes too aggressive
- Next.js memory thrashing / OOM (mitigated with supervisor restart)
- message-stream.js and service.js need refactoring (very large files)
