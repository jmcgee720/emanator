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
│   │   ├── providers/
│   │   │   ├── openai.js            # OpenAI/Proxy provider (tool_args_delta)
│   │   │   └── anthropic.js         # Anthropic provider
│   ├── api/
│   │   └── stream-handler.js        # SSE event relay
│   └── stream-client.js             # Frontend SSE parser + streaming fallback
├── components/dashboard/
│   ├── Dashboard.jsx                # State orchestrator
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
- [x] Fix Live Preview inline Babel runtime syntax error (regex anchoring + modName escaping)
- [x] Fix create-project JSON.parse error (defensive parsing in frontend + proxy raw passthrough)
- [x] Replace regex-based preview compiler with Babel AST plugin (robust for all code shapes)
- [x] System-wide task modes (build/inspect/config) — detected in intents.js, enforced in service.js
- [x] Reactive canvas aurora background — pulled from GitHub repo, replaces CSS aurora, activityLevel wired to chat state
- [x] Platform billing + credits system — credit pre-check before generation, deduction after success, in-chat upsell, model fallback, cost labels, error translation
- [x] Follow-up refinement routing — detects visual/content/layout edits on existing pages, injects current file content, routes through direct-edit
- [x] Preview refresh after refinement — robust hash (updated_at + content.length), directEditMode SSE flag, manual Refresh re-fetches files
- [x] Disable propose_plan as final output — build/edit requests that fail to produce executable diffs now return `PATCH FAILED` with `toolMode: patch_failed` instead of surfacing a non-actionable plan card
- [x] Fix const toolMode reassignment compile error
- [x] Fix trailing brace syntax error at EOF in service.js
- [x] JSON content sanitizer — intercepts model dumping tool-call JSON as plain text, auto-executes file writes, replaces with clean user message
- [x] Image prompt enhancement — Unsplash URLs with concrete examples, explicit "NEVER say you can't add images" instruction in both refinement and build modes
- [x] Two-tier image system — Stock (curated Unsplash, auto-detect keywords, "Finding images..." status) + Custom/Premium (AI-generated via GPT Image 1, 3x credits). Toggle in homepage prompt bar and in-project ChatComposer. Backend: image-prefetch.js module, service.js integration, stream-handler passthrough, credits multiplier.
- [x] Code completeness validator — Detects truncated/incomplete JSX/JS/CSS before saving (bracket balance, JSX tag balance, truncation signals). Auto-repairs via AI completion call. Prevents broken previews from incomplete generation.

## P1 — Upcoming
- [ ] Phase 2-5 conversational AI architecture
- [ ] CSV export for Growth panel

## P2 — Future
- [ ] Deploy integration (Vercel/Netlify) — currently mocked
- [ ] Refactor service.js (~2850 lines → modular breakdown)
- [ ] Core System self-editing architecture
- [ ] Growth analytics panel

## 3rd Party Integrations
- OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key (Proxy)
- Stripe (Payments) via Emergent Test Key
- Supabase (DB/Auth) via .env
