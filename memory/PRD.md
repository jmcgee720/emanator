# Emanator PRD — Agent Platform (COMPLETE)

## Vision
Full agent platform with sandboxed execution, multi-step reasoning, session memory, screenshot verification, build checking, smart model routing, vision support, and conversational intelligence. Emanator can now never break its own build — auto-verify + auto-revert on every edit.

## Architecture
- Next.js 14 App Router + E2B Sandboxed Execution
- Agent Loop: while(true) with max 12 iterations, tool handlers INSIDE the loop
- 9 tools: read_files, patch_files, update_files, edit_lines, verify_build, exec_command, screenshot_verify, update_memory, update_canvas
- Smart Model Router: auto-selects gpt-4o vs gpt-4o-mini based on task
- Vision Support: GPT-4o image analysis in self-edit mode
- Auto-Verify: Every edit_lines call in self-edit mode is verified against health check, auto-reverts on failure
- Conversational Intelligence: frustration/feedback/followup detection + adaptive prompts

## Key Safety Features
1. **edit_lines auto-verify**: After every disk write, health check runs. On failure → auto-revert from originalContent
2. **promote-to-live auto-revert**: Snapshot before write, health check after, auto-revert on failure
3. **Regression guard**: Blocks overwrites that shrink files > 50%
4. **Package import validation**: Blocks imports of non-installed packages
5. **Agent loop structure**: Tool handlers inside while(true), agentLoopContinue check after handlers

## Completed (2026-04-15, iterations 84-90)
- Phase 7: Line-Based Editing (23 tests)
- Phase 8: Screenshot Self-Edit (local Playwright)
- Phase 9: Codebase Refactoring (Dashboard 3333→2004, message-stream 3417→3214)
- Phase 10: Features (CSV Export, ZIP Download, classifyUserIntent, /export-zip)
- Phase 11: Intelligence Layer (model routing, vision, E2B pre-install, phase adaptation)
- Phase 12: Critical Bug Fixes (agent loop structure, ProjectGrid.jsx syntax, auto-verify)

## Tech Stack
Next.js 14, OpenAI GPT-4o/GPT-4o-mini via Emergent LLM Key, E2B, Supabase, MongoDB, Stripe
