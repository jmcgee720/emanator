# Emanator PRD

## Product Vision
Emanator is a conversational AI website builder that generates premium, visually stunning websites through natural language conversation. It features real-time live preview, AI-powered image generation, and a Tailwind CSS design system.

## Core Requirements
- AI generates complete React websites from Creative Brief input
- Live Preview shows the site building in real-time during streaming
- Generated sites must use standard Tailwind CSS utility classes (no custom classes)
- AI image generation replaces stock photos with custom art-directed images
- Generated images MUST persist across page reloads and render in the preview
- System must handle context limits (max_tokens: 16384) gracefully
- Generated sites must be VISUALLY STUNNING — gradient text, SVG logos, glassmorphism, glow effects
- AI must use multi-column grid layouts (up to 4 columns) for sections with multiple items

## Architecture
- **Framework**: Next.js 14 App Router
- **Preview**: srcdoc iframe with Babel inline transpilation + Tailwind CDN v3.4.17
- **AI**: OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key proxy
- **Images**: GPT Image 1 via Emergent LLM Key
- **DB**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Payments**: Stripe

## Image Pipeline Architecture
1. `image-prefetch.js` → `generateArtDirectedImages()` generates base64 images
2. `buildImagePromptContext()` creates placeholder URLs (`emanator-generated.img/__gen_img_X.png`)
3. AI uses placeholder URLs in generated code
4. `message-stream.js` emits `generated_images_map` SSE event (placeholder → dataUrl mapping)
5. `file-operations.js` saves generated images as `_assets/__gen_img_X.png` files (base64 content, file_type='image')
6. `_assets/` files are excluded from AI context (filtered by classifyProject) but loaded by PreviewTab
7. `PreviewTab.jsx` builds `imageAssets` from _assets/ files OR SSE event data
8. `buildReactPreview()` injects `window.__GEN_IMAGE_MAP__` + `MutationObserver` into srcdoc
9. MutationObserver swaps placeholder URLs → base64 data URLs for both `<img src>` and CSS `background-image`

## Key Files
- `/app/components/dashboard/tabs/PreviewTab.jsx` — Preview rendering, Babel transpilation, image mapping
- `/app/components/dashboard/Dashboard.jsx` — State orchestrator, SSE event capture (generatedImageMap)
- `/app/components/dashboard/RightPanel.jsx` — Props passthrough
- `/app/lib/ai/message-stream.js` — AI orchestrator, emits generated_images_map SSE event
- `/app/lib/ai/file-operations.js` — File saving, _assets/ image persistence
- `/app/lib/ai/prompt-builder.js` — Design recipes + grid layout instructions
- `/app/lib/ai/design-system.js` — Premium dark default + design rules + grid enforcement
- `/app/lib/ai/image-prefetch.js` — AI art direction and image generation
- `/app/lib/stream-client.js` — SSE client
- `/app/lib/supabase/db.js` — Database operations

## What's Been Implemented
- [x] Conversational AI builder with streaming SSE
- [x] Live Preview iframe with Babel transpilation
- [x] Tailwind CSS rendering (pinned CDN v3.4.17)
- [x] Streaming shell creation for live builds
- [x] AI image generation pipeline (end-to-end: generation → placeholder → SSE → _assets/ → preview)
- [x] Image persistence via _assets/ DB files (survives page reloads)
- [x] SSE-based live image mapping (generated_images_map event)
- [x] MutationObserver for img src AND CSS background-image swapping
- [x] Premium design recipes in prompt-builder.js
- [x] Default premium_dark preset
- [x] Multi-column grid layout instructions (up to 4 columns)
- [x] Grid enforcement in design-system.js (rule #12)
- [x] Context explosion prevention (no base64 in code files/prompts)
- [x] Code truncation auto-repair
- [x] Preview skeleton loading state
- [x] Regression guardrails
- [x] Stripe payments
- [x] Smart isNodeProject detection

## Backlog
### P1
- Phase 3: Section Template Library
- Conversational AI phases 2-5
- CSV export
- Optimize _assets/ file loading (currently 4-6MB response; consider lazy-loading or separate endpoint)

### P2
- Visual Quality Scoring
- Style Transfer
- Deploy integration (Vercel/Netlify)
- Refactor message-stream.js (~1900 lines) and service.js (~2600 lines)

## Known Issues
- Pre-fix projects (Glass Arrow, Coffee Grid Test) need a rebuild to get _assets/ images
- _assets/ files add 4-6MB to project file API responses (performance concern for slow connections)
- Next.js memory thrashing / OOM (mitigated with supervisor restart)
- Pre-existing SWC syntax warning at message-stream.js (non-blocking)
