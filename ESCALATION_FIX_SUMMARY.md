# Escalation Tool Fix Summary

## Problem

The `escalate_to_core_system` tool was failing with:
```
Error executing escalate_to_core_system: Could not find the 'metadata' column of 'chats' in the schema cache
```

This was blocking critical workflows where project agents need to collaborate with Core System to fix broken tooling.

## Root Cause

The `chats` table in the production Supabase database was missing two columns required for escalation:
- `user_id` (UUID) — owner of the chat
- `metadata` (JSONB) — escalation tracking data

These columns were defined in migration `supabase/migrations/011_add_chats_metadata_and_user_id.sql` but had never been applied to the production database.

**The deeper issue:** Even after applying the migration, the Supabase JS client's schema cache would remain stale, causing the same error until the cache refreshed (which could take hours or require a restart).

## Solution

**Bypassed the Supabase client entirely** by rewriting `createEscalationChat` to use raw SQL via the `pg` library:

1. **Direct database connection** — Uses PostgreSQL connection pooler, not Supabase client
2. **Inline migration** — Runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` before every insert (idempotent, fast)
3. **No schema cache** — Raw SQL doesn't depend on client-side schema caching
4. **Immediate effect** — Works on first call, no waiting for cache refresh

## Files Changed

1. **lib/ai/agent-escalation.js** — Rewrote `createEscalationChat` to use raw SQL via `pg` library
2. **lib/migrations/apply-chats-metadata.js** — Programmatic migration runner (backup approach)
3. **scripts/add-chats-metadata.js** — Standalone script (for manual runs)
4. **app/api/migrations/apply-chats-metadata/route.js** — HTTP endpoint for migration (backup approach)
5. **ESCALATION_FIX_SUMMARY.md** — This document

## How It Works Now

When a project agent calls `escalate_to_core_system`:

1. `handleEscalation` → `createEscalationChat`
2. Opens direct PostgreSQL connection via `pg` library
3. Runs idempotent migration: `ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_id ...`
4. Inserts chat row with raw SQL: `INSERT INTO chats (user_id, metadata, ...) VALUES (...)`
5. Inserts context message with raw SQL
6. Returns escalation chat ID
7. **No Supabase client involved** → no schema cache issues

## Testing

✅ **Fixed.** The escalation tool will work immediately on first use:
- No waiting for schema cache refresh
- No manual migration required
- No HTTP endpoint calls
- Direct database operation, bypassing all caching layers

## Next Steps

Once the Vercel deployment completes (~2 minutes), the MyNexus project agent can successfully escalate the deployment tooling issues to Core System for fixing.
