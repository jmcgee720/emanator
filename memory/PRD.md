# Emanator PRD — Agent Platform

## Vision
Full agent platform with sandboxed execution, multi-step reasoning, session memory, screenshot verification, and build checking. Making Emanator work like E1/Emergent — able to reliably read, edit, verify, and screenshot its own code.

## Architecture
- Next.js 14 App Router conversational AI builder
- E2B Sandboxed Execution: isolated Linux VM per project
- Agent Loop: max 12 iterations per turn (read -> edit -> exec -> verify -> screenshot -> remember)
- 9 agent tools: read_files, patch_files, update_files, edit_lines, verify_build, exec_command, screenshot_verify, update_memory, update_canvas

## Completed Phases

### Phase 1: E2B Sandbox (COMPLETE)
- lib/e2b/sandbox-service.js — sandbox lifecycle, file I/O, command execution
- lib/e2b/agent-tools.js — handleReadFiles, handleVerifyBuild, handleExecCommand, handleEditLines

### Phase 2: Agent Loop (COMPLETE)
- Multi-turn tool execution with agentLoopContinue flag
- Max 12 iterations, read_files removed after 4 calls

### Phase 3: Context Management (COMPLETE)
- 28 self-edit targets with smart keyword routing
- Auto file injection, large file warnings
- Model routing infrastructure

### Phase 4: Testing Framework (COMPLETE)
- lib/e2b/screenshot-service.js — Playwright-based screenshot for sandbox + local modes
- screenshot_verify tool works for both regular projects (E2B sandbox) and self-edit mode (local Playwright)
- verify_build tool: compilation checking via health endpoint or sandbox build
- exec_command tool: run npm test or any shell command

### Phase 5: Session Memory (COMPLETE)
- lib/e2b/memory-service.js — auto-save + explicit save + build summary
- Auto-saves after each file edit
- update_memory tool for AI to save notes
- Memory loaded into system prompt at conversation start
- Auto-prunes at 50 entries

### Phase 6: Model Router (COMPLETE)
- Provider + model selectable per request

### Phase 7: Line-Based Editing (COMPLETE - 2026-04-15)
- `edit_lines` tool: line-number-based file editing (replace, insert_after, delete)
- `read_files` returns numbered lines for ALL code paths (sandbox, DB fallback, self-edit)
- Edits sorted bottom-to-top so line numbers stay valid for multi-edit
- System prompt + agent loop nudges enforce `edit_lines` as preferred editing method
- 23 tests (18 unit + 4 integration + 1 numbering) all passing

### Phase 8: Codebase Refactoring (COMPLETE - 2026-04-15)
- Dashboard.jsx: 3333 -> 2872 lines (extracted 14 CRUD functions to useDashboardProject.js)
- message-stream.js: 3417 -> 3128 lines (extracted 5 helper functions to message-helpers.js)
- screenshot-service.js: Enhanced with describeScreenshotLocal() for self-edit mode
- All verified with testing agent — zero regressions

### UI Features
- ProjectGrid.jsx extracted (351 lines), bulk select/delete (tested 100%)
- All earlier features: patch reliability, broken promise detection, auto-revert, etc.

## File Structure (Key Files)
```
/app
├── lib/
│   ├── ai/
│   │   ├── message-stream.js      # Core agent loop (3128 lines)
│   │   ├── message-helpers.js     # Helper functions (285 lines) — NEW
│   │   ├── tools.js               # Tool schemas
│   │   ├── context-loader.js      # File/memory injection
│   │   ├── prompt-builder.js      # System prompt construction
│   │   ├── intents.js             # Intent classification
│   │   └── ...                    # 10+ other modules
│   ├── e2b/
│   │   ├── agent-tools.js         # read_files, edit_lines, verify_build, exec_command (323 lines)
│   │   ├── sandbox-service.js     # E2B container management
│   │   ├── screenshot-service.js  # Playwright screenshots (283 lines) — ENHANCED
│   │   └── memory-service.js      # Session memory
├── components/dashboard/
│   ├── Dashboard.jsx              # Main workspace (2872 lines, was 3333)
│   ├── useDashboardProject.js     # Project/Chat CRUD hook (475 lines) — NEW
│   └── ProjectGrid.jsx            # Grid view (351 lines)
```

## Remaining Backlog
- [ ] E2B custom template with Node.js + Playwright preinstalled (faster boot)
- [ ] Further refactor Dashboard.jsx (extract streaming logic ~800 lines)
- [ ] Further refactor message-stream.js (extract tool handlers ~900 lines)
- [ ] Multi-model routing: Claude for large reasoning, GPT-4o for quick edits
- [ ] Vision support for Core System chat
- [ ] CSV Export for project files
- [ ] Conversational AI Phases (classifyUserIntent)
- [ ] Deploy Integration (/api/projects/:id/export-zip)

## Tech Stack
- Next.js 14, OpenAI GPT-4o via Emergent LLM Key
- E2B for sandboxed execution
- Supabase (DB/Auth/Memory), MongoDB (credits), Stripe (payments)
