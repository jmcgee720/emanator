# Emanator PRD — Agent Platform

## Vision
Full agent platform with sandboxed execution, multi-step reasoning, session memory, screenshot verification, and build checking. Making Emanator work like E1/Emergent — able to reliably read, edit, verify, and screenshot its own code.

## Architecture
- Next.js 14 App Router conversational AI builder
- E2B Sandboxed Execution: isolated Linux VM per project
- Agent Loop: max 12 iterations per turn (read -> edit -> exec -> verify -> screenshot -> remember)
- 9 agent tools: read_files, patch_files, update_files, edit_lines, verify_build, exec_command, screenshot_verify, update_memory, update_canvas

## Completed Phases

### Phase 1-6: Foundation (COMPLETE)
- E2B Sandbox, Agent Loop, Context Management, Testing Framework, Session Memory, Model Router

### Phase 7: Line-Based Editing (COMPLETE - 2026-04-15)
- `edit_lines` tool with 23 passing tests
- `read_files` returns numbered lines for all code paths

### Phase 8: Screenshot Self-Edit (COMPLETE - 2026-04-15)
- `screenshot_verify` works for sandbox (E2B Playwright) and self-edit (local Python Playwright at /usr/bin/chromium)
- Returns headings, buttons, inputs, console errors, body preview

### Phase 9: Codebase Refactoring (COMPLETE - 2026-04-15)
- **Dashboard.jsx**: 3333 -> 2004 lines (40% reduction)
  - Extracted 14 CRUD functions to `useDashboardProject.js` (475 lines)
  - Extracted streaming logic to `useDashboardStream.js` (946 lines)
    - sendMessage, executePlan, applyDiffs, cancelDiffs, cancelPlan, retryWithFallback
    - 9 state variables (streamingMessageId, streamingStatus, pendingPlan, etc.)
- **message-stream.js**: 3417 -> 3128 lines
  - Extracted 5 helpers to `message-helpers.js` (285 lines)
- Zero regressions — verified across iterations 84-86

## File Structure
```
/app
├── lib/
│   ├── ai/
│   │   ├── message-stream.js      # Core agent loop (3128 lines)
│   │   ├── message-helpers.js     # Extracted helpers (285 lines)
│   │   ├── tools.js               # Tool schemas
│   │   └── ...                    # 10+ other modules
│   ├── e2b/
│   │   ├── agent-tools.js         # read_files, edit_lines, verify_build, exec_command (323 lines)
│   │   ├── screenshot-service.js  # Playwright screenshots — sandbox + local (283 lines)
│   │   ├── sandbox-service.js     # E2B container management
│   │   └── memory-service.js      # Session memory
├── components/dashboard/
│   ├── Dashboard.jsx              # Main workspace (2004 lines)
│   ├── useDashboardStream.js      # Streaming/plan/diff hook (946 lines)
│   ├── useDashboardProject.js     # Project/chat CRUD hook (475 lines)
│   └── ProjectGrid.jsx            # Grid view (351 lines)
```

## Remaining Backlog
- [ ] Further refactor message-stream.js (extract tool handlers ~900 lines)
- [ ] CSV Export for project files
- [ ] Conversational AI Phases (classifyUserIntent)
- [ ] Deploy Integration (/api/projects/:id/export-zip)
- [ ] E2B custom template with preinstalled deps
- [ ] Multi-model routing (Claude for reasoning, GPT-4o for quick edits)
- [ ] Vision support for Core System chat

## Tech Stack
- Next.js 14, OpenAI GPT-4o via Emergent LLM Key
- E2B for sandboxed execution
- Supabase (DB/Auth/Memory), MongoDB (credits), Stripe (payments)
