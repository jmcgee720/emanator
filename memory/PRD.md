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
- AI must use multi-column grid layouts (up to 4 columns) for sections with multiple items
- Generated images must persist across page reloads via _assets/ file storage

## Architecture
- **Framework**: Next.js 14 App Router
- **Preview**: srcdoc iframe with Babel inline transpilation + Tailwind CDN v3.4.17
- **AI**: OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key proxy
- **Images**: GPT Image 1 via Emergent LLM Key
- **DB**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Payments**: Stripe

## Key Files
- `/app/components/dashboard/tabs/PreviewTab.jsx` — Preview rendering, Babel transpilation, streaming shell, image asset mapping
- `/app/components/dashboard/Dashboard.jsx` — State orchestrator, SSE event capture (generatedImageMap)
- `/app/components/dashboard/RightPanel.jsx` — Props passthrough (generatedImageMap)
- `/app/lib/ai/message-stream.js` — Core AI orchestrator (~1900 lines), emits generated_images_map SSE event
- `/app/lib/ai/file-operations.js` — File saving, auto-repair, image post-processing, _assets/ saving
- `/app/lib/ai/prompt-builder.js` — Design recipes with code patterns + grid layout instructions
- `/app/lib/ai/design-system.js` — Premium dark default preset + design rules + grid enforcement
- `/app/lib/ai/image-prefetch.js` — AI art direction and image generation
- `/app/lib/stream-client.js` — SSE client, handles generated_images_map event

## What's Been Implemented
- [x] Conversational AI builder with streaming SSE
- [x] Live Preview iframe with Babel transpilation
- [x] Tailwind CSS rendering (pinned CDN v3.4.17, dark body default, forced rescan)
- [x] Streaming shell creation (valid empty shell for live builds)
- [x] AI image generation pipeline (placeholder → base64 via MutationObserver)
- [x] Image persistence via _assets/ DB files (survived page reloads)
- [x] SSE-based live image mapping (generated_images_map event)
- [x] Premium design recipes in prompt-builder.js (8 mandatory code patterns)
- [x] Default premium_dark preset in design-system.js
- [x] Multi-column grid layout instructions (up to 4 columns)
- [x] Context explosion prevention (no base64 in code files/prompts)
- [x] Code truncation auto-repair
- [x] Preview skeleton loading state during builds
- [x] Regression guardrails (blank preview detection, auto-retry)
- [x] Smart isNodeProject detection
- [x] CRA entry file filtering
- [x] Stripe payments integration

## Completed This Session (2026-04-11)
### P0: Image Pipeline Fix
- Added `generated_images_map` SSE event in message-stream.js (emits placeholder→dataUrl mapping after AI image generation)
- Wired SSE event through stream-client.js → Dashboard.jsx (state) → RightPanel → PreviewTab
- Added _assets/__gen_img_X.png file saving in file-operations.js for persistent image storage
- PreviewTab extracts _assets/ files on reload and builds imageAssets mapping
- MutationObserver + window.__GEN_IMAGE_MAP__ swaps placeholder URLs with base64 data in srcdoc iframe
- Fixed file-operations.js: stock photos now correctly used for placehold.co replacement (no longer accidentally mapping to emanator-generated.img URLs)

### P1: Multi-Column Grid Layouts
- Updated prompt-builder.js with explicit grid layout instructions for all sections (Features, Stats, Testimonials, Gallery, Team, Pricing, Footer)
- Added "LAYOUT VARIETY — CRITICAL" section mandating Tailwind grid classes with responsive breakpoints
- Updated design-system.js with mandatory rule #12: MULTI-COLUMN GRID LAYOUTS
- Verified: AI now generates grid-cols-1 md:grid-cols-2 lg:grid-cols-3 for features, grid-cols-1 md:grid-cols-3 for pricing

## Backlog
### P1
- **SVG Logo Quality** — AI should generate brand-specific SVGs (arrows for Glass Arrow, leaves for nature brands) instead of generic icons
- Phase 3: Section Template Library (reusable handcrafted React components)
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
- Pre-existing SWC syntax warning at message-stream.js:1978 (non-blocking)
