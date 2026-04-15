# Emanator PRD — Self-Sufficient Agent Platform

## How Emanator Works (Like E1)
1. User talks to Emanator → Emanator reads files → edits them → changes are LIVE immediately
2. No "Apply to Live" button anywhere — edits go directly to disk + DB
3. Auto-snapshot before every edit (backup in /app/.emanator-backups/)
4. Auto-verify after every edit (requests page to force recompilation)
5. If build breaks → auto-revert → user sees "retrying..." → AI retries → shows success only after build passes
6. tool_choice: required for action requests (AI must call tools, can't just talk)

## Architecture
- Next.js 14, E2B Sandbox, Agent Loop (while(true), max 12 iterations)
- Self-edit: edit_lines writes to disk → auto-verify → live
- Normal projects: save to DB → preview from srcDoc → live
- Rollback: /app/.emanator-backups/ stores last 20 versions per file

## Tech Stack
Next.js 14, OpenAI GPT-4o via Emergent LLM Key, E2B, Supabase, MongoDB, Stripe
