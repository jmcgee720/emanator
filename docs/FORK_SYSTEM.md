# Fork System Documentation

## Overview

The fork system prevents context limit errors by proactively warning users when conversations grow too long, then creating a new chat with a summary of the parent conversation.

## Architecture

### Backend Components

1. **Token Counter** (`lib/ai/token-counter.js`)
   - Estimates conversation token usage
   - Returns fork recommendations at 70% (warning) and 85% (critical) thresholds
   - Model-specific limits (200K for Claude, 128K for GPT-4o, etc.)

2. **Stream Handler** (`lib/api/stream-handler-v2.js`)
   - Checks fork needs before each message (lines 895-925)
   - Sends SSE events: `fork_suggested` (70-85%) and `fork_required` (>85%)
   - Blocks requests at critical threshold until user forks

3. **Fork Endpoint** (`lib/api/routes/chats.js` lines 585-690)
   - `POST /api/chats/:chatId/fork`
   - Creates new chat with `parent_chat_id` reference
   - Generates AI summary of parent conversation
   - Preserves self-edit mode indicator for Core System chats

4. **Fork Summary Generator** (`lib/ai/fork-summary.js`)
   - Auto-generates summary on first open of forked chat
   - Includes: work context, completed items, attachments, lineage tracking
   - Displays "Proceed" button to continue from parent context

### Frontend Components

1. **ForkButton** (`components/dashboard/ForkButton.jsx`)
   - Reusable button component
   - Handles fork API call and navigation
   - Shows loading state during fork operation

2. **ForkWarningBanner** (`components/dashboard/ForkWarningBanner.jsx`)
   - Displays warning/critical alerts
   - Shows token usage progress bar
   - Includes embedded ForkButton

3. **useForkWarning Hook** (`hooks/useForkWarning.js`)
   - Manages fork warning state
   - Provides `setForkWarning()` and `clearForkWarning()` methods

## Integration Guide

### Step 1: Add Fork Warning State

```jsx
import { useForkWarning } from '@/hooks/useForkWarning'
import ForkWarningBanner from '@/components/dashboard/ForkWarningBanner'

function ChatInterface() {
  const { forkWarning, setForkWarning, clearForkWarning } = useForkWarning()
  
  // ... rest of component
}
```

### Step 2: Listen for SSE Events

In your SSE event handler (usually in a `useEffect` or event listener):

```jsx
// Inside SSE message handler
if (event === 'fork_suggested') {
  setForkWarning({
    severity: 'warning',
    tokensUsed: data.tokensUsed,
    limit: data.limit,
    percentage: data.percentage,
    message: data.message,
  })
}

if (event === 'fork_required') {
  setForkWarning({
    severity: 'critical',
    tokensUsed: data.tokensUsed,
    limit: data.limit,
    percentage: data.percentage,
    message: data.message,
  })
}
```

### Step 3: Display Warning Banner

```jsx
return (
  <div>
    {forkWarning && (
      <ForkWarningBanner
        severity={forkWarning.severity}
        tokensUsed={forkWarning.tokensUsed}
        limit={forkWarning.limit}
        percentage={forkWarning.percentage}
        message={forkWarning.message}
        chatId={currentChatId}
        projectId={currentProjectId}
        onForked={(forkedChat) => {
          // Navigate to forked chat
          setCurrentChatId(forkedChat.id)
          clearForkWarning()
        }}
      />
    )}
    
    {/* Rest of chat UI */}
  </div>
)
```

## SSE Event Payloads

### `fork_suggested` (70-85% usage)

```json
{
  "tokensUsed": 140000,
  "limit": 200000,
  "percentage": 70,
  "message": "This conversation is getting long (140,000 / 200,000 tokens, 70%). Consider forking to a new chat soon to avoid hitting the limit mid-task."
}
```

### `fork_required` (>85% usage)

```json
{
  "tokensUsed": 175000,
  "limit": 200000,
  "percentage": 87.5,
  "message": "This conversation is getting very long (175,000 / 200,000 tokens, 88%). Please fork to a new chat to continue — I'll summarize what we've built so you can pick up where we left off."
}
```

## Fork Flow

1. **User sends message** → Stream handler checks token count
2. **70-85% threshold** → Send `fork_suggested` event, allow request to proceed
3. **>85% threshold** → Send `fork_required` event, block request with warning message
4. **User clicks Fork** → POST to `/api/chats/:chatId/fork`
5. **Backend creates new chat** → Sets `parent_chat_id`, generates title
6. **User opens forked chat** → Auto-generates summary with Proceed button
7. **User clicks Proceed** → Sends `[PROCEED]` which converts to friendly prompt

## Lineage Tracking

Forks can be chained (fork-of-fork). The system tracks lineage:

```
Original Chat (150 msgs)
  ↓ fork
Chat #1 (fork depth: 1)
  ↓ fork
Chat #2 (fork depth: 2)
```

Fork summaries include lineage info: "This is fork #2 in the chain."

## Testing

### Manual Test (Core System Chat)

1. Open Core System chat
2. Send ~50 long messages to approach 70% threshold
3. Verify `fork_suggested` banner appears
4. Continue to 85% threshold
5. Verify `fork_required` banner blocks new messages
6. Click "Fork Now"
7. Verify new chat opens with summary
8. Click "Proceed" button
9. Verify conversation continues from parent context

### Manual Test (Project Chat)

Same as above, but in a project chat (not Core System).

## Troubleshooting

### Fork button doesn't appear

- Check browser console for SSE event logs
- Verify `fork_suggested` or `fork_required` events are being received
- Ensure `useForkWarning` hook is integrated
- Check that `ForkWarningBanner` is rendered in the component tree

### Fork fails with error

- Check Network tab for `/api/chats/:id/fork` response
- Common errors:
  - 401: User not authenticated
  - 403: User lacks permission (self-edit chats are owner-only)
  - 404: Source chat not found
  - 500: AI summary generation failed (non-fatal, uses fallback)

### Forked chat is empty

- This is expected! The summary auto-generates on first open
- Check `/api/chats/:id/messages` GET request
- Verify `parent_chat_id` is set on the forked chat
- Check server logs for fork summary generation errors

### Proceed button doesn't work

- Verify the message metadata includes `is_fork_summary: true`
- Check that clicking Proceed sends `[PROCEED]` as message content
- Backend converts `[PROCEED]` to friendly prompt (stream-handler-v2.js line 787)

## Future Improvements

- [ ] Add fork button to message actions menu (always available)
- [ ] Show fork lineage in chat header
- [ ] Add "Jump to parent" button in forked chats
- [ ] Persist fork warnings across page refreshes
- [ ] Add fork analytics to admin panel
