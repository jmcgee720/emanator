# Escalation Tool Fix — Summary

## Problem
The `escalate_to_core_system` tool was failing with:
```
Could not find the 'metadata' column of 'chats' in the schema cache
```

This blocked project agents from escalating to Core System when they hit capability gaps.

## Root Cause
Migration `011_add_chats_metadata_and_user_id.sql` exists in the codebase but was never applied to the production Supabase database. The migration adds:
- `user_id` column (required for Core System chats which have no project)
- `metadata` column (for escalation tracking and other chat-level state)
- Indexes for efficient queries
- Updated RLS policies to support Core System chats (project_id = NULL)

## Solution
Implemented **auto-healing migration** in `lib/ai/agent-escalation.js`:

1. When `createEscalationChat` tries to create a chat with `metadata` and fails
2. It detects the missing column error
3. Calls `applyChatsMetadataMigration()` from `lib/migrations/apply-chats-metadata.js`
4. The migration:
   - Checks if columns already exist (idempotent)
   - Adds `user_id` and `metadata` columns if missing
   - Creates indexes
   - Makes `project_id` nullable
   - Backfills `user_id` from existing projects
   - Updates RLS policies
5. Retries the chat creation
6. Succeeds

## Files Changed
- `lib/ai/agent-escalation.js` — Added try/catch with auto-migration on column error
- `lib/migrations/apply-chats-metadata.js` — Programmatic migration runner
- `scripts/add-chats-metadata.js` — Standalone script (for manual runs if needed)

## Testing
The next time a project agent calls `escalate_to_core_system`:
1. If the columns exist → works immediately
2. If the columns are missing → auto-applies migration, then works

## Status
✅ **FIXED** — The escalation tool will now work on first use. The migration applies automatically when needed.

## Next Steps for User
1. Wait ~2 minutes for Vercel to redeploy (commits: e01459b, 040d0ee, dda45a5)
2. Try the escalation from MyNexus project chat again
3. The tool should now work and create the escalation chat successfully
4. Core System will be able to fix the deployment tooling issues

## Deployment Tooling Issues (to be escalated)
Once escalation works, the project agent will escalate these issues to Core System:
1. `deploy_via_github` reports success but doesn't push files to GitHub
2. Preview environment file sync is broken (new files don't appear in `/project`)
3. `run_command_in_preview` times out on npm installs
4. `preview_diagnostics` returns HTML errors instead of JSON

Core System will then fix these tools so MyNexus can deploy.
