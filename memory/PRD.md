# Emanator PRD — Self-Recovering Agent Platform

## Self-Recovery Architecture
1. **edit_lines** writes to disk → requests localhost:3000/ (forces recompilation) → checks HTML for "Build Error" → on failure: reads error from logs + HTML → auto-reverts → sends error + retry instructions back to AI → AI re-enters while loop and retries
2. **patch_files/update_files** saves to DB → writes to disk → requests page → checks HTML → on failure: reverts disk → injects retry message → agentLoopContinue=true → AI retries
3. **promote-to-live** snapshots → syntax validation → writes → health check → auto-reverts from snapshot
4. System prompt: "RECOVERY FROM FAILED EDITS" section + "NEVER stop after a failed edit"

## Key Fix (Iteration 92)
Auto-verify now requests the actual page (/) instead of /api/health. Health always returns 200 (checks DB only). The page request forces Next.js to recompile all imports and returns 500 or Build Error HTML when broken. Manually tested: broken JSX → 500 → caught → reverted → 200.

## Completed Features
- Line-based editing (23 tests), Screenshot verification, Session memory
- Smart model routing, Vision support, Conversational intelligence
- CSV/ZIP export, Archive feature, Codebase refactoring
- Agent loop with tool handlers inside while(true)
- Auto-verify + auto-revert + retry loop

## Tech Stack
Next.js 14, OpenAI GPT-4o via Emergent LLM Key, E2B, Supabase, MongoDB, Stripe
