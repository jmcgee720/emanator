# Emanator PRD — Self-Recovering Agent Platform

## Vision
Emanator is a self-recovering AI builder that can edit its own code, verify builds, and automatically fix its own mistakes — just like E1/Emergent.

## Self-Recovery Architecture (the key differentiator)
1. **edit_lines** writes to disk → auto-verifies health check → on failure: reads actual compilation error from nextjs_api.err.log → auto-reverts file → sends error + retry instructions back to AI → AI retries with corrected edit
2. **patch_files/update_files** saves to DB → writes to disk for verification → checks health → on failure: reverts disk from backup → includes error in response
3. **promote-to-live** snapshots before write → syntax validation → health check after → auto-reverts from snapshot on failure
4. **System prompt** has explicit "RECOVERY FROM FAILED EDITS" section with common mistake patterns
5. **Agent loop** says "NEVER stop after a failed edit — always retry"

## Agent Loop (while(true))
- Tool handlers are INSIDE the while loop (verified: lines 1279-2894)
- Max 12 iterations per request
- Tools: read_files, edit_lines, verify_build, exec_command, screenshot_verify, update_memory, patch_files, update_files, update_canvas

## Completed Features
- Line-based editing (edit_lines) with 23 tests
- Screenshot verification (local Playwright + E2B sandbox)
- Session memory (auto-save, explicit save, build summary)
- Smart model routing (gpt-4o for complex, gpt-4o-mini for quick)
- Vision support (GPT-4o image analysis in self-edit)
- Conversational intelligence (classifyUserIntent: 8 phases)
- CSV/ZIP export in CodeTab
- Archive feature (bulk archive/restore projects)
- Codebase refactoring (Dashboard.jsx 3333→2004, 3 extracted modules)

## Tech Stack
Next.js 14, OpenAI GPT-4o via Emergent LLM Key, E2B, Supabase, MongoDB, Stripe
