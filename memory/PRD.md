# Emanator AI Builder — Product Requirements

## Original Problem Statement
Continuously harden the Emanator AI Builder core system with modular architecture, intelligent image selection, guardrails, and growth tools.

## Architecture
```
/app (Next.js 14 App Router)
├── app/api/[[...path]]/route.js     # Pure dispatcher
├── lib/
│   ├── ai/
│   │   ├── service.js               # Core AI orchestrator (2730 lines, down from 3111)
│   │   ├── canvas-ops.js            # Canvas updates, search indexing, run logging
│   │   ├── context-loader.js        # Scoped/platform/workspace/project context loading
│   │   ├── file-operations.js       # Save/delete files with code validation + image replacement
│   │   ├── image-generation.js      # Image intent processing, variation detection, sprites
│   │   ├── image-prefetch.js        # AI Art Director / Creative Brief / Stock Photos
│   │   ├── code-validator.js        # Truncated JSX detection & auto-repair
│   │   ├── adaptive-learning.js     # User/project preference learning
│   │   ├── intents.js               # Intent detection & task mode classification
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
│   ├── GrowthPanel.jsx              # SEO analysis + CSV/JSON export + one-click Fix
│   └── tabs/PreviewTab.jsx          # Iframe preview + health check
```

## Completed (All Tested)
- [x] Direct-Build File Persistence & Preview Handoff
- [x] Live Streaming Preview Updates + Skeleton Loading
- [x] Regression guardrails (8 types including truncation detection)
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
- [x] **service.js Modular Refactor** (3111→2730 lines, 4 extracted modules)
- [x] **One-click SEO Fix** (Fix it / Fix all buttons in Growth Panel → auto-send to AI)

## P1 — Upcoming
- [ ] Deeper intent detection improvements (LLM-based classification)
- [ ] Further service.js breakdown (prompt templates extraction)

## P2 — Future
- [ ] Deploy integration (Vercel/Netlify) — currently mocked
- [ ] Core System self-editing architecture
- [ ] Growth analytics panel enhancements

## 3rd Party Integrations
- OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key (Proxy)
- Stripe (Payments) via Emergent Test Key
- Supabase (DB/Auth) via .env
- Unsplash (Stock Photos) — royalty-free
