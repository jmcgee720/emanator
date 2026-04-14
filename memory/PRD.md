# Emanator PRD

## Original Problem Statement
Build a self-editing AI builder (Emanator) that can reliably modify its own core files using targeted patches instead of destructive full-file rewrites.

## Core Architecture
- Next.js 14 App Router conversational AI builder
- Self-edit pipeline: reads file → applies patches → saves → Apply to Live → health check → auto-revert on failure
- Tools: `patch_files` (code edits), `update_canvas` (checklist/notes)
- Safety: syntax validation + bracket balance check + import validation + auto-revert on health check failure

## What's Been Implemented

### Phase 1-5: Self-Edit Pipeline (COMPLETE)
- patch_files with fuzzy matching, silent retry, export validation
- Auto-reload, enhanced diff view, intent detection

### Core Canvas PM Portal (COMPLETE)
- Markdown editor, interactive checkboxes, auto-save, AI auto-updates

### Conversational AI (COMPLETE)
- 3-tier intent detection, silent system messages, clean AI summaries

### Full Self-Modification (COMPLETE)
- 22 editable targets, health check, syntax validation, auto-revert

### Broken Promise Fix — All Core System (COMPLETE - Apr 12)
- identifyTargetFile() 3-strategy file identification
- Pre-identification loads target file content upfront
- Broken promise retry with file injection

### Stream Timeout Auto-Recovery (COMPLETE - Apr 13)
- Real keepalive SSE events every 8s
- Auto-recovery fetches saved messages/files from DB (3 retries)

### Auth Resilience (COMPLETE - Apr 13)
- navigator.locks patch suppresses AbortError
- 15s timeout on sign-in, 10s on session check
- Clean "Service Unavailable" toast when Supabase is down

### Import Validation Fix (COMPLETE - Apr 13)
- @/ path aliases no longer blocked as unknown packages

### Auto-Revert Self-Healing (COMPLETE - Apr 13)
- AI receives [SYSTEM: AUTO-REVERT] and explains + retries
- Bracket balance pre-check prevents most syntax-error reverts
- Works for both Core System and regular projects

### AI Conversation Memory (COMPLETE - Apr 13)
- Silent messages save full content in metadata.full_content
- Context loaders use full_content for AI, hidden from UI
- Conversational overrides prevent "review conversation" from routing to inspect mode
- cleanRefusalHistory increased from 4 to 12 messages

### Regular Builder AI Parity (COMPLETE - Apr 14)
- **Broken promise detector** ported to regular builds — catches "I'll build that" without tool call, retries with file injection
- **File context injection** — detects target file from user message + AI text, loads from project DB
- **Post-build auto-continue** — silent "what's next?" after Apply to Live for ALL projects
- **Auto-revert self-healing** — AI explains + retries for all project types, not just Core System

## Known Issues
- AI sometimes generates patches with wrong indentation (mitigated by fuzzy matching + retry)
- Supabase free tier may pause/slow after inactivity

## Remaining Backlog
- [ ] CSV export option (Emanator to self-implement)
- [ ] Conversational AI phases 2-5 (classifyUserIntent)
- [ ] Deploy integration (/api/projects/:id/export-zip)
- [ ] Vision support for Core System chat
- [ ] Refactor message-stream.js (~2800 lines) and service.js (~2600 lines)

## Tech Stack
- Next.js 14 App Router, OpenAI GPT-4o via Emergent LLM Key
- Supabase (DB/Auth), MongoDB (credits), Stripe (payments)
- Tailwind CSS + Shadcn UI
