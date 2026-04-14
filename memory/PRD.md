# Emanator PRD — Agent Platform

## Vision
Transform Emanator from a single-shot AI chat wrapper into a full agent platform with sandboxed execution, multi-step reasoning, and build verification.

## Architecture
- Next.js 14 App Router conversational AI builder
- **E2B Sandboxed Execution**: Each project gets an isolated Linux VM via E2B
- **Agent Loop**: AI calls tools sequentially (read → write → exec → verify → fix), max 6 iterations
- Tools: read_files, patch_files, update_files, verify_build, exec_command, update_canvas

## Phase 1: E2B Sandbox Integration (COMPLETE - Apr 14)

### Sandbox Service (`lib/e2b/sandbox-service.js`)
- `getOrCreateSandbox(projectId)` — creates/reuses E2B sandbox per project
- `syncFilesToSandbox(sandbox, files)` — syncs project files to sandbox filesystem
- `readSandboxFile/readSandboxFiles` — read files from sandbox
- `writeSandboxFile` — write files to sandbox
- `execInSandbox(sandbox, command)` — execute shell commands
- `installDependencies(sandbox)` — npm install in sandbox
- `verifyBuild(sandbox)` — npm run build + parse errors
- `runTests(sandbox)` — run test suites
- `listSandboxFiles` — list project files
- `killSandbox/cleanupStaleSandboxes` — lifecycle management

### Agent Tools (`lib/e2b/agent-tools.js`)
- `handleReadFiles` — reads via E2B sandbox (regular projects) or disk (self-edit)
- `handleVerifyBuild` — builds in sandbox or checks health (self-edit)
- `handleExecCommand` — runs arbitrary commands in sandbox

### Tool Definitions (`lib/ai/tools.js`)
- `exec_command` tool added — AI can run npm install, npm test, ls, etc.
- Core System tool set: patch_files, update_files, update_canvas, read_files, verify_build, exec_command

### Integration in message-stream.js
- Imported E2B agent tools, replaced inline handlers
- exec_command handler wired into agent loop with continuation

## Phase 2: Multi-Turn Agent Loop (COMPLETE - Apr 14)
- Agent loop with agentLoopContinue flag
- Max 6 iterations per turn, read_files removed after 2 calls
- Tool results fed back as messages for AI to decide next action

## Earlier Completed Work
- ProjectGrid extraction (351 lines), bulk select/delete
- 28 self-edit targets, smart keyword routing to small files
- Patch reliability: 3-level fuzzy matching, zero-apply prevention, corrective retry
- Broken promise + stalling detection
- Stream timeout recovery, auth resilience, auto-revert self-healing
- AI conversation memory, conversational routing

## Remaining Phases
- [ ] Phase 3: Context management (model switching, smart file loading)
- [ ] Phase 4: Testing framework (Playwright in sandbox, screenshot verification)
- [ ] Phase 5: Session memory (persistent project memory across chats)
- [ ] Phase 6: Model router (Claude for reasoning, GPT-4o for quick edits)
- [ ] Refactor Dashboard.jsx (3330 lines) and message-stream.js (3200+ lines)

## Tech Stack
- Next.js 14, OpenAI GPT-4o via Emergent LLM Key
- **E2B** for sandboxed execution (API key configured)
- Supabase (DB/Auth), MongoDB (credits), Stripe (payments)
