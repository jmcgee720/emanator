# Image Attachment Final Fix

## Problem
User attached `worldone.png` → AI tried to use `write_file` instead of referencing the already-uploaded file → created 96-byte stub instead of using the real image.

## Root Cause
The AI doesn't know that attachments were already saved to the project by the upload endpoint. The attachment metadata needs to include the saved path so the AI can reference it immediately.

## Solution

### 1. Enrich User Message Content
When a user attaches an image and sends a message, prepend a system note to the user's message content:

**Current flow:**
```
User: "use worldone.png as the background"
→ AI sees: "use worldone.png as the background"
→ AI tries: write_file("frontend/public/assets/ui/worldone.png", [96 bytes])
```

**Fixed flow:**
```
User: "use worldone.png as the background"
→ Upload endpoint saves to: public/images/worldone.png
→ AI sees: "[ATTACHED FILES: worldone.png has been saved to public/images/worldone.png (accessible at /images/worldone.png)]\n\nuse worldone.png as the background"
→ AI references: <img src="/images/worldone.png" />
```

### 2. Implementation

#### A. Update ChatComposer.jsx (line 230)
Change the message text to include attachment paths:

```javascript
const messageText = hasContent ? input.trim() : `[Uploaded ${uploadedAttachments.length} file(s)]`

// CHANGE TO:

let messageText = hasContent ? input.trim() : `[Uploaded ${uploadedAttachments.length} file(s)]`
if (uploadedAttachments.length > 0) {
  const attachmentPaths = uploadedAttachments
    .map(a => `  • ${a.filename} → ${a.path} (use ${a.public_url} in code)`)
    .join('\n')
  messageText = `[ATTACHED FILES - already saved to project:\n${attachmentPaths}]\n\n${messageText}`
}
```

#### B. Update stream-handler-v2.js (line 236)
Enhance the system prompt when attachments are present:

```javascript
// After line 236 where runAgentCore is called, modify the userMessage:

let enhancedUserMessage = content
if (metadata.attachments?.length > 0) {
  const attachmentContext = metadata.attachments
    .map(a => {
      if (a.path && a.public_url) {
        return `• ${a.filename} has been saved to ${a.path} (accessible in code as ${a.public_url})`
      }
      return `• ${a.filename} (${a.file_category})`
    })
    .join('\n')
  enhancedUserMessage = `[SYSTEM NOTE: The user attached files that are already saved to the project:\n${attachmentContext}]\n\n${content}`
}

const agentStream = runAgentCore({
  projectId: chat.project_id,
  chatId,
  userMessage: enhancedUserMessage, // Use enhanced version
  userId: dbUser.id,
  provider: providerName,
  model: modelName,
  scope: metadata.scope,
  selfEditTarget: isSelfEditChat ? (metadata.selfEditTarget || undefined) : undefined,
  attachments: metadata.attachments,
})
```

#### C. Update agent-tools-v2.js saveAttachmentTool description (line 556)
Change the tool description to clarify when to use it:

```javascript
description:
  `Save one of the user's CURRENT-MESSAGE attachments to a project file path. ` +
  `**IMPORTANT**: If the attachment has already been saved (check for a path in the attachment metadata), ` +
  `you do NOT need to call this tool — just reference the existing path in your code. ` +
  `Use this tool ONLY when you need to save the attachment to a DIFFERENT location than where it was auto-saved. ` +
  `write_file only accepts text and silently truncates binaries to a few bytes. ` +
  `Attachments available on this turn:\n  ${summary || '(none)'}`,
```

### 3. Expected Behavior After Fix

**User flow:**
1. User attaches `worldone.png` in chat
2. User types: "use this as the background"
3. User clicks Send

**Backend:**
1. `ChatComposer` → POST `/api/chats/:chatId/upload` with file
2. Server saves to `public/images/worldone.png`
3. Returns: `{ path: "public/images/worldone.png", public_url: "/images/worldone.png" }`

**AI sees:**
```
[SYSTEM NOTE: The user attached files that are already saved to the project:
• worldone.png has been saved to public/images/worldone.png (accessible in code as /images/worldone.png)]

use this as the background
```

**AI response:**
```
I'll update the component to use the worldone.png background you uploaded.

🔧 edit_file frontend/src/components/Background.jsx
  old_str: background: url('/images/placeholder.jpg')
  new_str: background: url('/images/worldone.png')

Done! The Italian kitchen scene is now your background.
```

### 4. Files to Modify

| File | Line | Change |
|------|------|--------|
| `components/dashboard/ChatComposer.jsx` | 230 | Prepend attachment paths to message text |
| `lib/api/stream-handler-v2.js` | 236 | Inject [SYSTEM NOTE] with saved paths |
| `lib/ai/agent-tools-v2.js` | 556 | Update saveAttachmentTool description |

### 5. Testing

1. Attach `test.png` in chat
2. Send message: "add this image to the header"
3. Check AI response:
   - ✅ Should reference `/images/test.png` directly
   - ✅ Should NOT call `write_file` with binary data
   - ✅ Should NOT call `save_attachment_to_path` (already saved)
   - ✅ Preview should show the image immediately

### 6. Why This Works

- **No tool confusion**: AI sees the file is already saved → no need for write_file or save_attachment
- **Clear path**: AI knows exactly what URL to use in code (`/images/filename.png`)
- **Immediate preview**: File is already in `public/images/` → Vite serves it on next reload
- **Works with all file types**: PDFs → `/docs/`, audio → `/audio/`, code → `src/components/`

## Status
- ✅ Upload endpoint created (commit 5fda0fd)
- ✅ ChatComposer wired (commits d661ddf, 862158f)
- ⚠️ **NEEDS**: Message enrichment (ChatComposer line 230)
- ⚠️ **NEEDS**: System prompt injection (stream-handler-v2 line 236)
- ⚠️ **NEEDS**: Tool description update (agent-tools-v2 line 556)

Apply the three changes above and the AI will automatically use uploaded images without trying to re-save them.
