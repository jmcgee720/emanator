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
