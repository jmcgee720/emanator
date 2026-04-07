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
│   │   ├── service.js               # Core AI orchestrator + guardrails
│   │   ├── image-prefetch.js        # AI Art Director / Creative Brief / Stock Photos
│   │   ├── code-validator.js        # Truncated JSX detection & auto-repair
│   │   ├── providers/
│   │   │   ├── openai.js            # OpenAI/Proxy provider (tool_args_delta)
│   │   │   └── anthropic.js         # Anthropic provider
│   ├── api/
│   │   └── stream-handler.js        # SSE event relay
│   └── stream-client.js             # Frontend SSE parser + streaming fallback
├── components/dashboard/
│   ├── Dashboard.jsx                # State orchestrator
│   ├── ChatComposer.jsx             # Input + Visual Mode toggle
│   ├── LeftPanel.jsx                # Chat messages UI
│   ├── RightPanel.jsx               # Tab layout
│   └── tabs/PreviewTab.jsx          # Iframe preview + blank health check
```

## Guardrails (Implemented)
1. **Direct-build integrity**: auto-retry if 0 files saved, conversational error on 2nd fail
2. **Tool call enforcement**: retry with explicit instruction if model returns text-only in direct-edit
3. **Success message truth**: only emitted when savedFiles.length > 0
4. **Streaming fallback**: user-friendly error message, never raw errors
5. **Preview health check**: detects blank #root after 3s, shows amber warning overlay
6. **Regression logging**: 7 structured console warnings/errors covering all failure modes

## Completed (All Tested)
- [x] Direct-Build File Persistence & Preview Handoff
- [x] Assistant Message UI Polish
- [x] Live Streaming Preview Updates
- [x] Preview iframe height fix (em-aurora CSS specificity)
- [x] Preview skeleton loading state
- [x] Regression guardrails
- [x] Fix Live Preview inline Babel runtime syntax error
- [x] Fix create-project JSON.parse error
- [x] Replace regex-based preview compiler with Babel AST plugin
- [x] System-wide task modes (build/inspect/config)
- [x] Reactive canvas aurora background
- [x] Platform billing + credits system
- [x] Follow-up refinement routing
- [x] Preview refresh after refinement
- [x] Disable propose_plan as final output
- [x] Fix const toolMode reassignment compile error
- [x] Fix trailing brace syntax error at EOF in service.js
- [x] JSON content sanitizer
- [x] Image prompt enhancement — Unsplash URLs with concrete examples
- [x] Two-tier image system — Stock (curated Unsplash) + Custom/Premium (AI-generated via GPT Image 1)
- [x] Code completeness validator — Truncated JSX detection & auto-repair
- [x] PatchGroundingValidator fallback — full file rewrite on grounding failure
- [x] AI Art Director pipeline — LLM-based creative brief generator, vibe lexicon, design intelligence prompt injection into system message (replaces keyword-based image detection)

## P1 — Upcoming
- [ ] Phase 2-5 conversational AI architecture
- [ ] CSV export for Growth panel

## P2 — Future
- [ ] Deploy integration (Vercel/Netlify) — currently mocked
- [ ] Refactor service.js (~3060 lines → modular breakdown)
- [ ] Core System self-editing architecture
- [ ] Growth analytics panel

## 3rd Party Integrations
- OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key (Proxy)
- Stripe (Payments) via Emergent Test Key
- Supabase (DB/Auth) via .env
- Unsplash (Stock Photos) — direct URLs, royalty-free
