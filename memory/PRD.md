# Emanator PRD — Agent Platform

## Vision
Transform Emanator from a single-shot AI chat wrapper into a full agent platform with sandboxed execution, multi-step reasoning, session memory, and build verification.

## Architecture
- Next.js 14 App Router conversational AI builder
- **E2B Sandboxed Execution**: Each project gets an isolated Linux VM
- **Agent Loop**: AI calls tools sequentially (read → write → exec → verify → fix → remember), max 6 iterations
- **Session Memory**: Persistent project memory across conversations
- Tools: read_files, patch_files, update_files, verify_build, exec_command, update_memory, update_canvas

## Completed Phases

### Phase 1: E2B Sandbox Integration (COMPLETE - Apr 14)
- `lib/e2b/sandbox-service.js` — sandbox lifecycle, file I/O, command execution, build verification
- `lib/e2b/agent-tools.js` — handleReadFiles, handleVerifyBuild, handleExecCommand
- E2B API key configured in .env.local and backend/.env

### Phase 2: Multi-Turn Agent Loop (COMPLETE - Apr 14)
- Agent loop with agentLoopContinue flag in message-stream.js
- Max 6 iterations per turn, read_files removed after 2 calls
- Tool results fed back as messages for AI to decide next action

### Phase 3: Context Management (COMPLETE - Apr 14)
- Smart file context injection (auto-identifies target files from user message)
- 28 self-edit targets with keyword routing to small files (<500 lines)
- Large file warnings (>500 lines → use update_files)
- Model routing infrastructure (provider + model selectable per request)

### Phase 4: Testing Framework (PARTIAL)
- verify_build tool checks compilation via health endpoint (self-edit) or sandbox build (projects)
- exec_command tool can run npm test in sandbox
- Playwright integration deferred (would require E2B custom template)

### Phase 5: Session Memory (COMPLETE - Apr 14)
- `lib/e2b/memory-service.js` — saveActionMemory, saveMemoryEntries, buildMemorySummary
- Auto-saves after each successful file edit (type, files, summary, success status)
- `update_memory` tool — AI can explicitly save notes for future conversations
- Memory loaded into system prompt at conversation start
- Relevance scoring + pruning (max 50 entries, top 10 by relevance)
- Uses existing Supabase project_memory table

### Phase 6: Model Router (COMPLETE - Apr 14)
- Smart model routing in stream-handler.js
- Provider + model selectable per request via metadata
- Infrastructure ready for multi-model routing (Claude/Gemini when needed)

## Earlier Completed Work
- ProjectGrid extraction (351 lines), bulk select/delete (tested 100%)
- Patch reliability: 3-level fuzzy matching, zero-apply prevention, corrective retry
- Broken promise + stalling detection, action enforcement
- Stream timeout recovery, auth resilience, auto-revert self-healing
- AI conversation memory, conversational routing
- patch_files → update_files fallback for large files

## Remaining Backlog
- [ ] Phase 4 complete: Playwright in E2B sandbox for screenshot testing
- [ ] E2B custom template with Node.js/Next.js preinstalled (faster sandbox boot)
- [ ] Refactor Dashboard.jsx (3330 lines) and message-stream.js (3200+ lines)
- [ ] Multi-model routing: Claude for large reasoning, GPT-4o for quick edits
- [ ] Vision support for Core System chat

## Tech Stack
- Next.js 14, OpenAI GPT-4o via Emergent LLM Key
- E2B for sandboxed execution
- Supabase (DB/Auth/Memory), MongoDB (credits), Stripe (payments)
