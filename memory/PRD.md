# Emanator AI Builder — Product Requirements

## Architecture
```
/app (Next.js 14 App Router)
├── lib/ai/
│   ├── service.js (2627 lines), prompt-builder.js, canvas-ops.js
│   ├── context-loader.js, file-operations.js, image-generation.js
│   ├── image-prefetch.js, code-validator.js, adaptive-learning.js
│   ├── intents.js (confidence scoring + LLM disambiguation)
├── components/dashboard/
│   ├── Dashboard.jsx — glass workspace layout, aurora background
│   ├── LeftPanel.jsx, RightPanel.jsx — inside em-glass panels
│   ├── CreativeBriefCard.jsx, SuggestionChips.jsx
│   ├── GrowthPanel.jsx — SEO + CSV/JSON + Fix + Build Better
```

## Completed
- [x] All core features (streaming, guardrails, Art Director, suggestions, etc.)
- [x] service.js Modular Refactor (3111→2627, 6 modules + prompt-builder)
- [x] LLM Intent Disambiguation + COMPLEX_DISQUALIFIERS fix
- [x] CSV Export, One-click SEO Fix, Build from SEO Analysis
- [x] **UI Redesign: Workspace glassmorphism layout** — em-glass rounded panels, aurora showing through, pill tabs, preview toolbar, dead code removed

## P1 — Remaining Steps
- [ ] Step 1: Extract executePlanStream → plan-executor.js
- [ ] Step 2: Extract processMessage → message-processor.js
- [ ] Step 3: Extract applyDiffs → file-operations.js
- [ ] Step 4: Growth analytics dashboard enhancements
- [ ] Step 5: Full UI Redesign polish (TopBar, project grid, etc.)

## 3rd Party Integrations
- OpenAI / Anthropic via Emergent LLM Key
- Stripe via Emergent Test Key, Supabase via .env, Unsplash
