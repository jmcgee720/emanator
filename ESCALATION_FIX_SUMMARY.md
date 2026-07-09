# ESCALATION UI DEBUGGING — NEXT STEPS

## CURRENT STATE

✅ **Escalation tool** (`escalate_to_core_system`) creates chats in database with correct metadata  
✅ **EscalationButton** component is mounted in AppShell.jsx  
✅ **useEscalationListener** hook queries for escalation chats  
❌ **Button stays gray** — hook is not finding the escalation chat

## DIAGNOSTIC STEPS

### 1. Check browser console logs

After hard refresh, you should see these logs:
```
[useEscalationListener] Fetching escalations for user: <uuid>
[useEscalationListener] All Core System chats: <number>
[useEscalationListener] First 3 chats: [...]
[useEscalationListener] Chat <id> : { isEscalation: ..., isResolved: ..., metadata: ... }
[useEscalationListener] Found escalations: <number>
```

**If you see these logs:** The hook is running. Check what the metadata values are.

**If you DON'T see these logs:** The hook is not running. Possible causes:
- AppShell.jsx didn't redeploy yet (wait 2 minutes after commit)
- Browser cache (hard refresh: Cmd+Shift+R / Ctrl+Shift+F5)
- User ID is null (auth issue)

### 2. Call the debug API endpoint

Open a new tab and navigate to:
```
https://auroraly.com/api/escalations/debug?id=b4e8d9c2-3f1a-4e5d-9a7b-2c1e5f8a6d3b
```

This will show:
- Does the escalation chat exist in the database?
- What is the `user_id` of the chat?
- What is YOUR `user_id`?
- Do they match?
- What does the metadata look like?
- What does each filter step return?

**Expected output:**
```json
{
  "user_id": "<your-uuid>",
  "escalation_lookup": {
    "id": "b4e8d9c2-...",
    "found": true,
    "chat": {
      "id": "b4e8d9c2-...",
      "user_id": "<your-uuid>",
      "project_id": null,
      "metadata": {
        "is_escalation": true,
        "auto_open": true,
        "resolved": null
      }
    }
  },
  "listener_query": {
    "found": true,
    "result": { ... }
  }
}
```

### 3. Possible root causes

#### A. User ID mismatch
**Symptom:** `chat.user_id` ≠ `your user_id` in the debug output

**Cause:** The escalation was created with a different user's ID (maybe the project agent used the wrong userId parameter)

**Fix:** Delete the bad escalation and create a new one:
```sql
DELETE FROM chats WHERE id = 'b4e8d9c2-3f1a-4e5d-9a7b-2c1e5f8a6d3b';
```
Then call `escalate_to_core_system` again from the MyNexus chat.

#### B. Metadata format issue
**Symptom:** `metadata.is_escalation` is not exactly `true` (might be string `"true"` or missing)

**Cause:** JSON serialization issue in `createEscalationChat`

**Fix:** Check the actual metadata value in the debug output. If it's `"true"` (string), update the filter:
```javascript
chat.metadata?.is_escalation === 'true' // string instead of boolean
```

#### C. Chat doesn't exist
**Symptom:** `escalation_lookup.found: false` in debug output

**Cause:** The chat was never created, or was deleted

**Fix:** Call `escalate_to_core_system` again from MyNexus chat to create a new escalation.

#### D. Supabase Realtime not subscribed
**Symptom:** Logs show "Found escalations: 0" but debug API shows the chat exists

**Cause:** The initial fetch works but Realtime subscription isn't triggering updates

**Fix:** This is less critical (button will activate on next page load), but we can add a polling fallback.

## IMMEDIATE ACTION

**Run the debug endpoint** and paste the output here. That will tell us exactly what's wrong.

```
https://auroraly.com/api/escalations/debug?id=b4e8d9c2-3f1a-4e5d-9a7b-2c1e5f8a6d3b
```

Once we see the diagnostic data, we can fix the exact issue.
