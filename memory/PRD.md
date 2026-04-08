# Emanator AI Builder - PRD

## Original Problem Statement
Build a conversational AI builder platform (Emanator) with a full-featured dashboard for creating, managing, and deploying AI-powered projects. Includes live preview, growth analytics, deployment integration, project templates, community marketplace with ratings, and scheduled auto-crawl.

## Core Architecture
- **Frontend**: Next.js 14 App Router on port 3000
- **Backend**: Custom API dispatcher in `app/api/[[...path]]/route.js`
- **Database**: Supabase (primary), MongoDB (growth/monitors)
- **Auth**: Supabase auth (cookie-based)
- **Integrations**: OpenAI/Anthropic (Emergent LLM Key), Stripe, Vercel, Netlify

## Feature Status

### Completed Features
- [x] Dashboard UI with glassmorphism Aurora theme
- [x] Conversational AI builder with streaming
- [x] Live preview with Babel inline transpilation
- [x] Preview skeleton loading state + regression guardrails
- [x] Service.js modular refactoring
- [x] Site Monitor (Growth Panel auto-crawl)
- [x] Deploy Tab (ZIP, Vercel, Netlify)
- [x] Share Public Preview Link with expiry
- [x] Next.js OOM Memory Fix
- [x] Template Marketplace (publish/clone/delete, 25 templates, ratings & reviews)
- [x] Creative Brief Modal (centered popup, "Start Building" auto-sends AI prompt)
- [x] **Preview Third-Party Library Support** (React Router DOM CDN, icon lib stubs, framer-motion stubs, Babel import resolver)

### Preview Third-Party Library Support (Apr 7 2026)
**Problem**: AI-generated code using react-router-dom, lucide-react, framer-motion, etc. crashed the inline Babel preview with `ReferenceError` because only React/ReactDOM were available.
**Solution**:
- Added React Router DOM v6 UMD from CDN
- Added global bindings for all Router exports (BrowserRouter, Routes, Route, Link, NavLink, Navigate, Outlet, useNavigate, useParams, useLocation, useSearchParams)
- Added Proxy-based SVG stub components for icon libraries (lucide-react, heroicons, react-icons)
- Added framer-motion stubs (motion proxy, AnimatePresence, useAnimation, useInView, useScroll)
- Enhanced Babel AST plugin ImportDeclaration visitor to resolve named/aliased imports from `__MODULE_STUBS__` before removing

### Creative Brief Feature (Apr 7 2026)
- Removed "Brief" button from TopBar — accessible only from ProjectHub quick actions
- Converted from right-side panel to centered modal popup (580px, glass-morphism styled)
- Form has 6 collapsible sections: Big Picture, Brand & Style, Pages & Structure, Key Features, Content Direction, Technical & Constraints
- "Start Building" button saves brief + creates chat + auto-sends prompt to AI
- Brief data persists via canvas API and auto-injects into AI system prompt via context.js

### PATCH FAILED Fix + Auto-Execute Flow (Feb 2026)
- Eliminated all 3 hardcoded `PATCH FAILED: no executable changes produced` suppression paths in `message-stream.js`
- Revised/self-critique plans that exceed safe thresholds now surface as PlanCard for user approval instead of failing
- New projects from Creative Brief auto-execute immediately (no PlanCard pause)
- All auto-execute paths now emit `preview_partial` events for real-time live preview during generation
- New project success message includes next-step suggestions (customize, add pages, add features)
- Large plans on existing projects surface PlanCard for approval

### Plan Validator Fixes (Feb 2026)
- Fixed "Invalid plan: Plan targets wrong project" — projectId check downgraded from blocking error to warning (redundant check since message-stream stamps projectId)
- Increased max file count limit from 10 to 30 (initial builds from Creative Brief easily exceed 10 files)
- Warning threshold raised from 5 to 15 files

### Preview Import Resolution Fix (Feb 2026)
- Fixed `ReferenceError: Home is not defined` — Babel AST plugin now resolves local imports (`./components/Home`) to `window.__COMPONENTS__["Home"]`
- Entry file (App.jsx) sorted to compile last so all dependencies are available
- Each compiled component exposed as window global for cross-file references
- Clean success message without file listing

### Force Plan Mode for Creative Brief (Feb 2026)
- Creative Brief builds now always force `propose_plan` mode instead of letting the AI choose `create_files` (single file)
- Previously, the AI would cram everything into one `page.jsx` instead of generating a multi-file site
- Detection: messages containing "Build this project now with COMPLETE" or projects with 0 files

### Fix: Creative Brief Intent Misclassification (Feb 2026)
- **Bug**: `isSimpleFrontendEdit()` in `intents.js` incorrectly returned `true` for Creative Brief prompts, forcing `directEditMode` and bypassing the multi-file `propose_plan` flow
- **Fix**: Added 3 guard checks to `isSimpleFrontendEdit()`:
  1. Explicit marker check: returns `false` if message contains "Build this project now with COMPLETE"
  2. Length check: returns `false` for messages >600 chars (briefs are inherently detailed)
  3. New COMPLEX_DISQUALIFIERS: "production-ready pages", "SEPARATE COMPONENT FILES", "Pages needed", "component file...must be"
- Added `[ModeDecision]` debug log in `message-stream.js` showing `directEditMode`, `isBriefBuild`, `isNewProjectBuild`
- All 10 unit tests pass (tested with testing agent iteration_68)

### Design Excellence for Plan-Mode Builds (Feb 2026)
- **Problem**: Creative Brief builds used the plan-executor path which had generic "use rich Tailwind CSS" instructions, producing bland, unstyled output
- **Fix**: Created `buildDesignExcellenceBlock()` in `prompt-builder.js` with detailed design directives:
  - Mandatory Unsplash image URLs by category (kids, people, nature, products, tech, food, abstract)
  - Specific Tailwind patterns: glass-morphism, glow effects on buttons, gradient text, floating decorative elements
  - Mandatory page structure: sticky nav, hero with background image + overlay, 3+ content sections, footer
  - Visual depth requirements: hover micro-interactions, section variety, image overlays
  - Brand-specific content requirements
  - Per-file code standards (200-500 lines, proper exports)
- Injected `buildDesignExcellenceBlock()` into `plan-executor.js` system message
- Added `DESIGN QUALITY FOR NEW PROJECTS` section to plan-phase prompt in `message-stream.js` (conditional on `isNewProjectBuild`)
- Cleaned up `CanvasPanel.jsx` brief prompt to be less verbose while keeping the "Build this project now with COMPLETE" marker
- All 18 unit tests pass (tested with testing agent iteration_69)
- Added `Audio` constructor mock to preview sandbox to prevent media resource errors
- Increased plan-executor `max_tokens` from 8192 to 16384 for more complete code generation
- Added SSE heartbeat every 10 seconds to prevent proxy/ingress from closing idle connections
- Added `X-Accel-Buffering: no` header to prevent nginx from buffering SSE streams
- Added automatic retry (2 retries with backoff) in stream-client for 502/503/504 errors
- Skipped self-critique for new projects (saves an extra AI round-trip, reducing memory pressure)
- Reduced chat history in plan-executor from 10 messages to 3 (with 500 char truncation) to lower memory usage
- ALL plans now auto-execute directly — no PlanCard, no Review Changes, no Apply flow
- Previously, projects with existing files from failed attempts would fall through to PlanCard/Review, causing "Apply failed" errors

### Key API Endpoints
- `POST /api/chat/stream` - AI streaming
- `GET/POST /api/projects` - Project CRUD
- `GET/POST /api/marketplace` - Community templates
- `POST /api/marketplace/publish` - Publish template
- `POST /api/marketplace/:id/clone` - Clone template
- `POST /api/marketplace/:id/reviews` - Add review
- `GET/POST /api/share` - Share links with expiry
- `POST /api/deployments` - Deploy to Vercel/Netlify
- `GET/POST /api/growth/monitors/schedule` - Auto-crawl config

### Key DB Schema
- `projects` - User projects
- `snapshots` - Shared previews, marketplace templates
- `chats`, `messages` - Conversation history
- `project_files` - Project code files
- `deployments` - Deploy records
- `growth_monitors` (MongoDB) - Site monitors
- `canvas` - stores creative_brief JSON

## Backlog
- Refactor `message-stream.js` (~1800 lines, very complex nested logic)
- Refactor `service.js` (~2600 lines)
- Deploy integration (Vercel/Netlify) — currently partially mocked

### Stream Client SWC Fix (Feb 2026)
- **Bug**: `stream-client.js` had broken indentation from a previous edit — the IIFE pattern `;(async () => { ... })().catch(...)` with misaligned try/catch/while blocks caused SWC (Next.js compiler) to throw `Expected a semicolon` syntax error. This prevented the Dashboard from loading the streaming module, causing "Stream request failed" on every generation attempt.
- **Fix**: Rewrote `stream-client.js` with a clean named `async function runStream()` instead of the IIFE pattern. Proper consistent indentation throughout. All retry/error handling preserved.
- Verified: No SWC compilation errors after restart.

### Creative Brief Auto-Send Race Condition Fix (Feb 2026)
- **Bug**: The `useEffect` that auto-sends the Creative Brief prompt had `[messagesReadyTick]` as its only dependency. If `selectedChat` wasn't set at the exact moment the tick changed (race condition after `createChat`), the prompt was permanently lost — "nothing was sent".
- **Fix**: Added `selectedChat`, `selectedProject`, `streamingMessageId` to the dependency array so the effect also fires when the chat becomes available.

### Lazy Component Resolution for Cross-File Imports (Feb 2026)
- **Bug**: In the Babel preview sandbox, local imports like `import Header from './Header'` were resolved eagerly at eval() time: `var Header = window.__COMPONENTS__["Header"]`. If Header.jsx hadn't been compiled yet (wrong file order), `Header` was permanently `undefined`, causing "Element type is invalid" React crash.
- **Fix**: 
  1. Added `__lazy(modName)` helper using `React.forwardRef` that defers `window.__COMPONENTS__` lookup to render time (all files compiled by then)
  2. Changed both default and named import handlers to use `__lazy()` wrappers
  3. Unknown package imports now generate `__stubComponent()` calls instead of being silently removed (prevents undefined variables)
  4. Added `_EBClass` error boundary around the mounted entry component — catches and displays render errors gracefully instead of crashing the whole preview
  5. Added two-pass compilation: all files compiled twice so Pass 2 resolves any cross-file references missed in Pass 1
- **Critical streaming fix**: The `live_update` postMessage handler was **clearing `window.__COMPONENTS__ = {}`** on every incoming file, wiping all previously compiled components. Also used `entryName` (always the incoming file) instead of the correct `modName`. Fixed both: handler now accumulates components incrementally and uses `filePath` for modName.
- postMessage now sends `filePath` alongside code so the iframe can compute the correct modName
- Entry resolution now prefers "App" → entryName → first available component
- All verified with standalone streaming simulation test (6 files, zero errors)
