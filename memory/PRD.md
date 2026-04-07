# Emanator AI Builder — Product Requirements

## Original Problem Statement
Continuously harden the Emanator AI Builder core system with modular architecture, intelligent image selection, guardrails, growth tools, and smart intent detection.

## Architecture
```
/app (Next.js 14 App Router)
├── lib/ai/
│   ├── service.js               # Core orchestrator (2627 lines)
│   ├── prompt-builder.js        # System prompt templates
│   ├── canvas-ops.js            # Canvas updates, search, logging
│   ├── context-loader.js        # Scoped context loading
│   ├── file-operations.js       # Save/delete with validation
│   ├── image-generation.js      # Image intent processing
│   ├── image-prefetch.js        # AI Art Director / Stock Photos
│   ├── code-validator.js        # Truncated JSX auto-repair
│   ├── adaptive-learning.js     # User preference learning
│   ├── intents.js               # Intent detection + confidence + LLM disambiguation
│   ├── providers/
├── components/dashboard/
│   ├── Dashboard.jsx, LeftPanel.jsx, ChatComposer.jsx
│   ├── CreativeBriefCard.jsx, SuggestionChips.jsx
│   ├── GrowthPanel.jsx          # SEO + CSV/JSON + Fix + Build Better
```

## Completed (All Tested)
- [x] All previous features (live streaming, skeleton, guardrails, etc.)
- [x] AI Art Director pipeline + Creative Brief + Suggestion Chips
- [x] CSV/JSON Export + Response Truncation Detection
- [x] service.js Modular Refactor (3111→2627, 6 modules)
- [x] One-click SEO Fix + Build from SEO Analysis
- [x] LLM Intent Disambiguation with confidence scoring
- [x] Prompt Template Extraction (prompt-builder.js)
- [x] **CRITICAL FIX: COMPLEX_DISQUALIFIERS too broad** — "subscription" alone was blocking landing page requests from premium direct-edit mode. Fixed to require specific backend signals (stripe integration, payment gateway, etc.)

## P1 — Upcoming
- [ ] Further service.js breakdown (executePlanStream, processMessage)
- [ ] Growth analytics dashboard enhancements

## P2 — Future
- [ ] Deploy integration (Vercel/Netlify)
- [ ] Core System self-editing architecture
- [ ] Multi-page project generation

## 3rd Party Integrations
- OpenAI / Anthropic via Emergent LLM Key
- Stripe via Emergent Test Key
- Supabase via .env
- Unsplash — royalty-free
