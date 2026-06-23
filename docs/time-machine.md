# Time Machine — Core System Safety Net

## Problem

Core System occasionally breaks itself during self-edit sessions:
- **2026-05-22**: Deleted `let priorMessages = ...` → crashed every project chat for 12 hours
- **2026-05-24**: Screenshot fabrication bug → vision pipeline broken for days
- **2026-05-28**: Vision pipeline broken again → users saw fabricated screenshot contents

When this happens, you need **Emerge** (the external LLM) to fix it, but Emerge doesn't know what the "last known good" state was.

## Solution

**Time Machine** auto-snapshots the Auroraly source tree every 5 commits and provides tools to:
1. **List** recent snapshots
2. **Diff** current state vs a snapshot
3. **Revert** to a snapshot (destructive — requires confirmation)

## Usage

### 1. List Snapshots

```
list_snapshots
```

Returns:
```
Found 12 snapshot(s):

1. Auto-snapshot 2026-05-28 14:32 [auto]
   ID: abc123...
   Files: 247 (1.2 MB)
   Commit: 5c63dc9
   Created: 2026-05-28T14:32:15Z

2. Before auth refactor
   ID: def456...
   Files: 245 (1.1 MB)
   Commit: 7274371
   Created: 2026-05-27T09:15:42Z
```

### 2. Diff a Snapshot

```
diff_snapshot({ snapshot_id: "abc123..." })
```

Returns:
```
Diff vs snapshot: Auto-snapshot 2026-05-28 14:32
Total changes: 8

Added (2):
  + lib/ai/time-machine.js
  + docs/time-machine.md

Modified (5):
  ~ lib/ai/agent-tools-v2.js
  ~ lib/api/stream-handler-v2.js
  ~ components/chat/ChatInterface.jsx
  ~ lib/supabase/db.js
  ~ package.json

Deleted (1):
  - lib/ai/deprecated-tool.js
```

### 3. Create a Manual Snapshot

```
create_snapshot({ name: "Before risky refactor" })
```

Returns:
```
Snapshot created: Before risky refactor
  ID: xyz789...
  Files: 247
  Commit: 5c63dc9
  Created: 2026-05-28T15:00:00Z

This snapshot can be reverted to via revert_to_snapshot if something breaks.
```

### 4. Revert to a Snapshot

**DANGER**: This overwrites **ALL** files in the repo. Use only as a last resort.

First attempt (without confirmation):
```
revert_to_snapshot({ snapshot_id: "abc123...", confirmed: false })
```

Returns:
```
REVERT BLOCKED — confirmation required.

revert_to_snapshot is a DESTRUCTIVE operation. It will overwrite ALL files in the Auroraly repo with the snapshot contents.

To proceed, the user must explicitly type "CONFIRMED: revert" in their next message, then you may retry with confirmed=true.

Before reverting, consider:
  • Have you tried debugging the issue first?
  • Do you know what broke and when?
  • Is there a more surgical fix available?

Revert is a last resort when Core System has broken itself and you cannot fix it manually.
```

After user types `CONFIRMED: revert`:
```
revert_to_snapshot({ snapshot_id: "abc123...", confirmed: true })
```

Returns:
```
Reverted to snapshot: Auto-snapshot 2026-05-28 14:32
  Files restored: 247
  Files failed: 0

All files restored successfully.

Vercel will redeploy automatically (~2 minutes). Wait for the deploy to complete before testing.
```

## Auto-Snapshots

Time Machine automatically creates a snapshot every **5 commits** to the Auroraly repo. These are tagged `[auto]` in the snapshot list.

Auto-snapshots are triggered by `github-writer.js` after each successful write. The counter resets after each snapshot.

## Snapshot Storage

- **Table**: `snapshots` (Supabase)
- **Project ID**: `auroraly-core` (hardcoded — snapshots are scoped to Core System only)
- **Max snapshots**: 50 (auto-prunes oldest when limit hit)
- **Snapshot contents**: Full file tree (path + content) as JSON

## When to Use

### ✅ Good Use Cases

1. **Before risky refactors**: `create_snapshot({ name: "Before auth refactor" })`
2. **After Core System breaks itself**: `list_snapshots` → `diff_snapshot` → `revert_to_snapshot`
3. **When Emerge needs to fix Core System**: "List snapshots, find the last one before the breakage, revert to it"

### ❌ Bad Use Cases

1. **Version control**: Use Git for that (snapshots are a safety net, not a VCS)
2. **Project files**: Snapshots are Core System only (user projects have their own file history)
3. **Frequent manual snapshots**: Auto-snapshots every 5 commits is enough

## Failure Modes

### Snapshot creation fails
- **Cause**: GitHub API rate limit, missing GITHUB_TOKEN, network error
- **Impact**: No snapshot created, but writes continue (auto-snapshot failures don't block commits)
- **Fix**: Check Vercel logs for the error, verify GITHUB_TOKEN is set

### Revert fails
- **Cause**: GitHub API rate limit, missing GITHUB_TOKEN, file conflicts
- **Impact**: Partial revert (some files restored, some failed)
- **Fix**: Check the `failed_files` array in the response, manually fix the failed files

### Snapshot is stale
- **Cause**: Auto-snapshot interval is too long (5 commits)
- **Impact**: Reverting loses recent changes
- **Fix**: Create manual snapshots before risky changes

## Architecture

```
lib/ai/time-machine.js          — Snapshot creation, listing, revert, diff
lib/ai/agent-tools-v2.js         — Tool definitions (create_snapshot, list_snapshots, etc.)
lib/supabase/db.js               — db.snapshots CRUD (already existed)
lib/ai/github-writer.js          — Auto-snapshot trigger (TODO: add maybeAutoSnapshot call)
```

## Next Steps

1. **Hook auto-snapshot into github-writer.js**: Add `maybeAutoSnapshot()` call after each successful write
2. **Test revert flow**: Create a snapshot, break something, revert, verify
3. **Add snapshot metadata**: Track which user/chat created the snapshot, why it was created
4. **Snapshot compression**: Store diffs instead of full file trees (future optimization)

## Example Session

```
User: "Core System broke itself again. Can you revert to the last working state?"

Agent: [calls list_snapshots]
"I see 12 snapshots. The most recent auto-snapshot is from 14:32 today (abc123...). 
Before that, there's one from 09:15 yesterday (def456...). 
Let me diff the most recent one to see what changed."

Agent: [calls diff_snapshot({ snapshot_id: "abc123..." })]
"The diff shows 8 changes since that snapshot:
  • Added: lib/ai/time-machine.js, docs/time-machine.md
  • Modified: lib/ai/agent-tools-v2.js, lib/api/stream-handler-v2.js, ...
  • Deleted: lib/ai/deprecated-tool.js

The breakage is likely in one of the modified files. Do you want me to revert to this snapshot?"

User: "CONFIRMED: revert"

Agent: [calls revert_to_snapshot({ snapshot_id: "abc123...", confirmed: true })]
"Reverted to snapshot 'Auto-snapshot 2026-05-28 14:32'. 247 files restored successfully. 
Vercel is redeploying now — give it 2 minutes, then refresh and test."
```
