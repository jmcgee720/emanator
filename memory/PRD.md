# Emanator PRD

## Original Problem Statement
Build a conversational AI builder (Emanator) that lets users submit a Creative Brief and auto-generates complete, multi-page, production-ready websites. The system should stream step-by-step build progress, render live previews, and handle billing/credits securely.

## Core Requirements
1. Creative Brief -> AI auto-builds complete multi-page sites
2. Step-by-step build walkthrough in chat (plan breakdown + file progress)
3. Contextual completion summaries
4. No AI refusals for image generation
5. Live preview with cross-file React imports (Babel inline transpilation)
6. Billing security: single entry point for AI calls, credit checks on all AI paths, no raw provider error leakage

## Architecture
- **Framework**: Next.js 14 App Router
- **Auth**: Supabase
- **DB**: Supabase (projects, chats, messages, project_files) + MongoDB (credits)
- **AI Providers**: OpenAI GPT-4o, Anthropic Claude (via Emergent LLM Key)
- **Payments**: Stripe (Emergent Test Key)
- **Preview**: Babel standalone inline transpiler in iframe with `window.__COMPONENTS__` registry

## What's Been Implemented

### Phase 1 - Core Pipeline (DONE)
- Creative Brief modal and auto-build pipeline
- Live streaming preview with postMessage
- Dark Aurora skeleton loading state during builds
- Regression guardrails (auto-retry on missing files/blank previews)
- Intent detection (isSimpleFrontendEdit fixed for briefs)
- Design excellence enforcement in prompt-builder and plan-executor

### Phase 2 - Chat UX Improvements (DONE)
- Whimsical loading phrases (build milestones log)
- Removed "Ready when you are" placeholder
- Fixed PM auto-continue race conditions (disabled due to DB timeouts)
- Image upload support (base64 pass-through)
- Verification response formatting (conversational AI text)
- Live preview JSON leak fix

### Phase 3 - Design Overhaul Phase 1 & 2 (IN PROGRESS)
- AI image generation enabled by default in message-stream.js
- Industry-specific design tokens/palettes in design-system.js
- prompt-builder.js and image-prefetch.js still need updating

### Phase 4 - Stream Reliability & Build Pipeline (DONE - Apr 9, 2026)
- Fixed "Stream request failed" on new project creation
  - Root cause: 80+ concurrent preview-snapshot DB queries overwhelming PostgreSQL
  - Fixed by replacing DB-heavy ProjectThumbnail with lightweight initials
  - Memoized initializeOwner() to stop per-request DB hits
  - Added retry to getAuthUser() for transient Supabase timeouts
  - Expanded stream-client retry to cover 401/408/429/5xx errors
  - Fixed Python SSE proxy to use stream=True for real-time event forwarding
- Fixed stream handler to NOT abort on client disconnect (files now save to DB even if browser closes)
- Persistent Build Log: Status phrases now stay visible in chat as permanent log lines during builds
- Removed Creative Direction card from chat UI (design context is internal only)
- Brief Build Pipeline: New projects from Creative Brief now build immediately (no plan-then-approve flow)
  - Forced create_files tool choice for brief builds
  - Skip PatchGroundingValidator for new empty projects
  - Direct file save path (bypass diff review pipeline)
  - PM-style summary after build: what was built, suggestions, next steps
- Hidden instruction no longer leaks into visible user messages (displayContent vs aiContent separation)
- Media Bin: Added image upload section to Creative Brief form (drag-drop, remove, base64)

## Upcoming Tasks (Prioritized)
### P1
- Complete Design Overhaul Phase 1 & 2: Update prompt-builder.js (remove Unsplash URLs, enforce tokens) and image-prefetch.js (better art direction)
- Design Overhaul Phase 3: Section Template Library (reusable React components for AI assembly)
- Conversational AI architecture phases 2-5 (Intent Detection, Task Scope Classification, Silent Validation Retries, Learning System)

### P2
- Design Overhaul Phase 4: Visual Quality Scoring
- Design Overhaul Phase 5: Style Transfer (paste URL to copy visual DNA)
- Design Overhaul Phase 6: Multi-Variant Generation
- Deploy integration (Vercel/Netlify)
- Refactor service.js (~2600 lines) and message-stream.js (~1900 lines)
- CSV export option

## Known Issues
- PM Auto-Continue disabled (causes DB statement timeouts from overlapping API requests)
- Next.js memory thrashing / OOM (mitigated: restart supervisorctl if unresponsive)
- OpenAI TPM rate limits can cause brief build failures on back-to-back requests (auto-retry handles this)

## Key Files
- `/app/lib/ai/message-stream.js` - Core streaming pipeline with brief build mode
- `/app/lib/ai/service.js` - AI orchestrator
- `/app/lib/ai/design-system.js` - Design tokens and palettes
- `/app/lib/ai/prompt-builder.js` - System prompt construction
- `/app/lib/ai/image-prefetch.js` - AI image generation
- `/app/lib/api/stream-handler.js` - SSE stream handler
- `/app/lib/stream-client.js` - Frontend SSE client with retry
- `/app/components/dashboard/Dashboard.jsx` - State orchestrator
- `/app/components/dashboard/LeftPanel.jsx` - Chat UI with build log
- `/app/components/dashboard/InlineBrief.jsx` - Creative Brief form with Media Bin
- `/app/backend/server.py` - Python proxy with SSE streaming
