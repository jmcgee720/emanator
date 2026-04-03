# Emanator AI Builder — Product Requirements

## Original Problem Statement
Continuously harden the Emanator AI Builder core system:
1. Fix direct-build file persistence/preview handoff (**DONE**)
2. Polish assistant message UI (**DONE**)
3. Implement live streaming preview updates during direct-builds (**DONE**)

## Architecture
```
/app (Next.js 14 App Router)
├── app/api/[[...path]]/route.js     # Pure dispatcher
├── lib/
│   ├── ai/
│   │   ├── service.js               # Core AI orchestrator (~2600 lines)
│   │   ├── providers/
│   │   │   ├── openai.js            # OpenAI/Proxy provider (tool_args_delta)
│   │   │   └── anthropic.js         # Anthropic provider
│   ├── api/
│   │   └── stream-handler.js        # SSE event relay
│   └── stream-client.js             # Frontend SSE parser
├── components/dashboard/
│   ├── Dashboard.jsx                # State orchestrator
│   ├── LeftPanel.jsx                # Chat messages UI
│   ├── RightPanel.jsx               # Tab layout
│   └── tabs/PreviewTab.jsx          # Iframe preview
```

## Key Technical Concepts
- **Direct-Edit Mode**: Single-file scoped requests. `tool_choice` forced to `create_files`/`update_files`.
- **Live Preview Streaming**: `tool_args_delta` → length-based throttle (300 chars) → `preview_partial` SSE → progressive buffer (200ms drain) → postMessage iframe updates.
- **CSS Fix**: `.em-aurora.absolute { position: absolute; }` overrides the base `.em-aurora { position: relative; }`.

## Completed (All Tested)
- [x] Direct-Build File Persistence & Preview Handoff
- [x] Assistant Message UI Polish
- [x] Live Streaming Preview Updates
- [x] Preview iframe height fix (em-aurora CSS specificity)

## P1 — Upcoming
- [ ] Phase 2-5 conversational AI architecture
- [ ] CSV export for Growth panel

## P2 — Future
- [ ] Deploy integration (Vercel/Netlify) — currently mocked
- [ ] Refactor service.js (~2600 lines → modular breakdown)
- [ ] Core System self-editing architecture
- [ ] Growth analytics panel

## 3rd Party Integrations
- OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key (Proxy)
- Stripe (Payments) via Emergent Test Key
- Supabase (DB/Auth) via .env
