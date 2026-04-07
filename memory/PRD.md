# Emanator AI Builder — Product Requirements

## Original Problem Statement
Continuously harden the Emanator AI Builder core system:
1. Fix direct-build file persistence/preview handoff (**DONE**)
2. Polish assistant message UI (**DONE**)
3. Implement live streaming preview updates during direct-builds (**DONE**)
4. Implement preview skeleton loading state for direct-build generation (**DONE**)
5. Lock stability — implement regression guardrails (**DONE**)

## Architecture
```
/app (Next.js 14 App Router)
├── app/api/[[...path]]/route.js     # Pure dispatcher
├── lib/
│   ├── ai/
│   │   ├── service.js               # Core AI orchestrator + guardrails + truncation retry
│   │   ├── image-prefetch.js        # AI Art Director / Creative Brief / Stock Photos
│   │   ├── code-validator.js        # Truncated JSX detection & auto-repair
│   │   ├── adaptive-learning.js     # User/project preference learning + diff event tracking
│   │   ├── intents.js               # Intent detection & task mode classification
│   │   ├── providers/
│   ├── api/
│   │   ├── stream-handler.js        # SSE event relay
│   │   └── routes/diffs.js          # Diff approval/rejection + learning events
│   └── stream-client.js             # Frontend SSE parser + streaming fallback
├── components/dashboard/
│   ├── Dashboard.jsx                # State orchestrator
│   ├── ChatComposer.jsx             # Input + Visual Mode toggle
│   ├── LeftPanel.jsx                # Chat messages + CreativeBriefCard + SuggestionChips
│   ├── CreativeBriefCard.jsx        # Shows detected creative direction
│   ├── SuggestionChips.jsx          # Organic AI enhancement suggestion chips
│   ├── GrowthPanel.jsx              # SEO analysis + CSV/JSON export
│   └── tabs/PreviewTab.jsx          # Iframe preview + blank health check
```

## Guardrails (Implemented)
1. **Direct-build integrity**: auto-retry if 0 files saved
2. **Tool call enforcement**: retry if model returns text-only in direct-edit
3. **Success message truth**: only emitted when savedFiles.length > 0
4. **Streaming fallback**: user-friendly error, never raw errors
5. **Preview health check**: blank #root detection after 3s
6. **Regression logging**: 7 structured console warnings
7. **Response truncation detection**: auto-retry on unclosed code blocks, incomplete JS/JSX, trailing braces
8. **Code completeness validation**: truncated JSX detection & auto-repair in saveFiles

## Completed (All Tested)
- [x] Direct-Build File Persistence & Preview Handoff
- [x] Assistant Message UI Polish
- [x] Live Streaming Preview Updates
- [x] Preview skeleton loading state
- [x] Regression guardrails (6 types)
- [x] Fix Live Preview inline Babel runtime syntax error
- [x] System-wide task modes (build/inspect/config)
- [x] Platform billing + credits system
- [x] Disable propose_plan as final output
- [x] JSON content sanitizer
- [x] Two-tier image system — Stock + Custom/Premium
- [x] Code completeness validator
- [x] PatchGroundingValidator fallback
- [x] AI Art Director pipeline — LLM creative brief + design intelligence
- [x] Creative Brief Preview Card
- [x] Enhancement Suggestion Chips (organic, AI-driven)
- [x] CSV + JSON Export for Growth Panel
- [x] Response Truncation Detection & Auto-Retry
- [x] Adaptive Learning Events for Diff Approval/Rejection
- [x] Intent Detection (intents.js — regex-based classifier)
- [x] Task Scope Classification (classifyRequestMode)
- [x] Adaptive Learning System (buildAdaptiveContext → system prompt injection)

## P1 — Upcoming
- [ ] Refactor service.js (~3100 lines → modular breakdown)
- [ ] Deeper intent detection improvements (LLM-based classification)

## P2 — Future
- [ ] Deploy integration (Vercel/Netlify) — currently mocked
- [ ] Core System self-editing architecture
- [ ] Growth analytics panel enhancements

## 3rd Party Integrations
- OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key (Proxy)
- Stripe (Payments) via Emergent Test Key
- Supabase (DB/Auth) via .env
- Unsplash (Stock Photos) — direct URLs, royalty-free
