# Emanator AI Builder — Product Requirements

## Original Problem Statement
Continuously harden the Emanator AI Builder core system with modular architecture, intelligent image selection, guardrails, growth tools, and smart intent detection.

## Architecture
```
/app (Next.js 14 App Router)
├── app/api/[[...path]]/route.js     # Pure dispatcher
├── lib/
│   ├── ai/
│   │   ├── service.js               # Core orchestrator (2627 lines, from 3111)
│   │   ├── prompt-builder.js        # System prompt templates (PM, Refinement, New Build)
│   │   ├── canvas-ops.js            # Canvas updates, search indexing, run logging
│   │   ├── context-loader.js        # Scoped/platform/workspace/project context
│   │   ├── file-operations.js       # Save/delete with code validation + image replacement
│   │   ├── image-generation.js      # Image intent processing, variations, sprites
│   │   ├── image-prefetch.js        # AI Art Director / Creative Brief / Stock Photos
│   │   ├── code-validator.js        # Truncated JSX detection & auto-repair
│   │   ├── adaptive-learning.js     # User/project preference learning
│   │   ├── intents.js               # Intent detection + confidence scoring + LLM disambiguation
│   │   ├── providers/
│   ├── api/
│   │   ├── stream-handler.js        # SSE event relay
│   │   └── routes/diffs.js          # Diff approval + learning events
│   └── stream-client.js             # Frontend SSE parser
├── components/dashboard/
│   ├── Dashboard.jsx                # State orchestrator
│   ├── ChatComposer.jsx             # Input + Visual Mode toggle
│   ├── LeftPanel.jsx                # Chat + CreativeBriefCard + SuggestionChips
│   ├── CreativeBriefCard.jsx        # Detected creative direction display
│   ├── SuggestionChips.jsx          # Organic AI enhancement suggestion chips
│   ├── GrowthPanel.jsx              # SEO + CSV/JSON export + Fix it + Build Better Version
│   └── tabs/PreviewTab.jsx          # Iframe preview + health check
```

## Completed (All Tested)
- [x] Direct-Build File Persistence & Preview Handoff
- [x] Live Streaming Preview Updates + Skeleton Loading
- [x] Regression guardrails (8 types)
- [x] System-wide task modes + billing + credits
- [x] Disable propose_plan + JSON sanitizer
- [x] Two-tier image system (Stock + Custom)
- [x] Code completeness validator + PatchGroundingValidator fallback
- [x] AI Art Director pipeline (LLM creative brief + design intelligence)
- [x] Creative Brief Preview Card
- [x] Enhancement Suggestion Chips (organic, AI-driven)
- [x] CSV + JSON Export for Growth Panel
- [x] Response Truncation Detection & Auto-Retry
- [x] Adaptive Learning Events for Diff Approval/Rejection
- [x] **service.js Modular Refactor** (3111→2627 lines, 5 extracted modules + prompt-builder)
- [x] **One-click SEO Fix** (Fix it / Fix all buttons)
- [x] **Build from SEO Analysis** (Build Better Version button → competitor analysis → AI build)
- [x] **LLM Intent Disambiguation** (confidence scoring + lightweight LLM call for ambiguous prompts)
- [x] **Prompt Template Extraction** (prompt-builder.js: PM, Refinement, New Build modes)

## P1 — Upcoming
- [ ] Further service.js breakdown (executePlanStream, processMessage extraction)
- [ ] Growth analytics dashboard enhancements

## P2 — Future
- [ ] Deploy integration (Vercel/Netlify) — currently mocked
- [ ] Core System self-editing architecture
- [ ] Multi-page project generation

## 3rd Party Integrations
- OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key (Proxy)
- Stripe (Payments) via Emergent Test Key
- Supabase (DB/Auth) via .env
- Unsplash (Stock Photos) — royalty-free
