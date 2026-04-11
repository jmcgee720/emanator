# Emanator PRD

## Product Vision
Emanator is a conversational AI website builder that generates premium, visually stunning websites through natural language conversation.

## Image Pipeline Architecture (Critical)
1. `image-prefetch.js` generates base64 images + creates placeholder URLs (`emanator-generated.img/__gen_img_X.png`)
2. `message-stream.js` emits `generated_images_map` SSE event (placeholder -> dataUrl mapping) EARLY in the stream
3. AI writes code using placeholder URLs
4. `file-operations.js` saves code files synchronously, then saves `_assets/__gen_img_X.png` **ASYNCHRONOUSLY** (fire-and-forget)
5. Frontend gets image data from SSE event during live build, OR from `_assets/` DB files on reload
6. `PreviewTab.jsx` injects `window.__GEN_IMAGE_MAP__` + `MutationObserver` into srcdoc iframe
7. MutationObserver swaps placeholder URLs -> base64 data URLs for `<img src>` and CSS `background-image`

**CRITICAL: `_assets/` saves MUST be async (fire-and-forget) to avoid SSE stream timeout (60s proxy limit)**

## Core System Self-Edit (Phase 1 - COMPLETE)
- `SELF_EDIT_TARGETS` in `constants.js` defines editable files
- New self-edit targets added: Prompt Builder, Design System, Image Generator
- Backend `message-stream.js` uses `selfEditTarget.path` for path-scoped validation
- UI dropdown in LeftPanel.jsx renders all targets from constants
- **Bug fix**: Task mode enforcement was rejecting self-edit requests (classified as `edit` intent -> `plan` mode -> file contents forbidden). Fixed by skipping task mode enforcement for self-edit chats in `message-stream.js`, and always sending `selfEditTarget` from `Dashboard.jsx` even for "All Core System" selection.

## Key Files
- `/app/components/dashboard/tabs/PreviewTab.jsx` - Preview rendering, image mapping
- `/app/components/dashboard/Dashboard.jsx` - State orchestrator, SSE capture
- `/app/components/dashboard/RightPanel.jsx` - Props passthrough
- `/app/components/dashboard/LeftPanel.jsx` - Core System self-edit dropdown
- `/app/lib/ai/message-stream.js` - AI orchestrator, SSE events
- `/app/lib/ai/file-operations.js` - File saving, async _assets/ persistence
- `/app/lib/ai/prompt-builder.js` - Design recipes + grid layouts (self-editable)
- `/app/lib/ai/design-system.js` - Premium dark + grid rules (self-editable)
- `/app/lib/ai/image-prefetch.js` - Image generation (self-editable)
- `/app/lib/stream-client.js` - SSE client
- `/app/lib/api/stream-handler.js` - SSE server, message_saved event
- `/app/lib/constants.js` - SELF_EDIT_TARGETS, roles, permissions

## What's Been Implemented
- [x] Full image pipeline (generation -> SSE -> _assets/ persistence -> MutationObserver)
- [x] Async _assets/ saving (prevents 60s timeout)
- [x] Multi-column grid layouts (up to 4 columns)
- [x] Premium dark design system
- [x] Live Preview with Babel + Tailwind CDN
- [x] Streaming shell + skeleton loading
- [x] Regression guardrails
- [x] Art-directed image generation (business context extraction)
- [x] Core System Self-Improvement Phase 1 (self-edit targets for prompt-builder, design-system, image-prefetch)

## Backlog
### P1
- Phase 3: Section Template Library
- Conversational AI phases 2-5
- Optimize _assets/ file loading (lazy-load images from separate endpoint)
- CSV export

### P2
- Visual Quality Scoring, Style Transfer, Deploy integration
- Refactor message-stream.js (~1900 lines) and service.js (~2600 lines)

## Known Issues
- Pre-fix projects (Glass Arrow) need a rebuild to work
- _assets/ files add 4-6MB to project file API responses
- Next.js memory thrashing (mitigated with supervisor restart)
