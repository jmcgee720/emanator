# Emanator PRD — Agent Platform

## Vision
Full agent platform with sandboxed execution, multi-step reasoning, session memory, screenshot verification, and build checking.

## Architecture
- Next.js 14 App Router conversational AI builder
- E2B Sandboxed Execution: isolated Linux VM per project
- Agent Loop: max 6 iterations per turn (read → write → exec → verify → screenshot → remember)
- 8 agent tools: read_files, patch_files, update_files, verify_build, exec_command, screenshot_verify, update_memory, update_canvas

## Completed Phases

### Phase 1: E2B Sandbox (COMPLETE)
- lib/e2b/sandbox-service.js — sandbox lifecycle, file I/O, command execution
- lib/e2b/agent-tools.js — handleReadFiles, handleVerifyBuild, handleExecCommand

### Phase 2: Agent Loop (COMPLETE)
- Multi-turn tool execution with agentLoopContinue flag
- Max 6 iterations, read_files removed after 2 calls

### Phase 3: Context Management (COMPLETE)
- 28 self-edit targets with smart keyword routing
- Auto file injection, large file warnings
- Model routing infrastructure

### Phase 4: Testing Framework (COMPLETE)
- lib/e2b/screenshot-service.js — Playwright-based screenshot + page description
- screenshot_verify tool: takes screenshot, returns page structure (headings, buttons, inputs, console errors)
- verify_build tool: compilation checking via health endpoint or sandbox build
- exec_command tool: run npm test or any shell command

### Phase 5: Session Memory (COMPLETE)
- lib/e2b/memory-service.js — auto-save + explicit save + build summary
- Auto-saves after each file edit (type, files, summary, success)
- update_memory tool for AI to save notes
- Memory loaded into system prompt at conversation start
- Auto-prunes at 50 entries

### Phase 6: Model Router (COMPLETE)
- Provider + model selectable per request
- Infrastructure ready for multi-model routing

### UI Features
- ProjectGrid.jsx extracted (351 lines), bulk select/delete (tested 100%)
- All earlier features: patch reliability, broken promise detection, auto-revert, etc.

## Remaining Backlog
- [ ] E2B custom template with Node.js + Playwright preinstalled (faster boot)
- [ ] Refactor Dashboard.jsx (3330 lines) into smaller components
- [ ] Refactor message-stream.js (3300+ lines)
- [ ] Multi-model routing: Claude for large reasoning, GPT-4o for quick edits
- [ ] Vision support for Core System chat

## Tech Stack
- Next.js 14, OpenAI GPT-4o via Emergent LLM Key
- E2B for sandboxed execution
- Supabase (DB/Auth/Memory), MongoDB (credits), Stripe (payments)
