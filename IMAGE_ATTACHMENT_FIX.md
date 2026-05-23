# Image Attachment Auto-Handling — Implementation Plan

## Problem
User attaches an image to chat → has to manually upload it via Code tab → breaks flow

## Solution
When user attaches an image, AI automatically:
1. Saves it to `public/images/` in the project
2. References it in the generated code
3. No manual upload needed

## Implementation

### 1. File Tree Refresh Fix ✅ DEPLOYED
**Issue:** File tree rebuilds on every render → blocks clicks  
**Fix:** Memoized `buildFileTree()` with `React.useMemo(() => buildFileTree(), [files])`  
**File:** `components/dashboard/tabs/CodeTab.jsx`  
**Status:** Deployed to main (commit e2011d6, 14d1905)

### 2. Auto-Save Attachments (Next Step)

**Flow:**
```
User attaches image.jpg
  ↓
ChatComposer uploads to /api/chats/:id/upload
  ↓
Server saves to project_files:
  - path: public/images/image.jpg
  - content: <base64 data URL>
  ↓
AI receives:
  - User message: "use this image in the header"
  - Attachment metadata: { filename, path: "public/images/image.jpg" }
  ↓
AI generates code:
  <img src="/images/image.jpg" alt="Header" />
```

**API Endpoint Needed:**
```javascript
// POST /api/chats/:chatId/upload
// Body: { files: [{ filename, mime_type, data }] }
// Returns: { uploads: [{ filename, path, success }] }
```

**Changes Required:**

1. **Add upload endpoint** (`lib/api/routes/chats.js`)
   ```javascript
   if (route.match(/^\/chats\/[^/]+\/upload$/) && method === 'POST') {
     // Save attachments to project_files
     // Return paths for AI context
   }
   ```

2. **Update ChatComposer** (`components/dashboard/ChatComposer.jsx`)
   - Change `onUploadFiles` to call `/api/chats/:chatId/upload`
   - Return saved paths to sendMessage

3. **Update AI prompt** (agent-core or stream-handler)
   - When attachments present, add to system prompt:
     ```
     User attached images saved to:
     - public/images/logo.png
     Use these in your generated code.
     ```

### 3. Smart Path Selection

**Logic:**
- `.png/.jpg/.webp/.svg` → `public/images/`
- `.pdf` → `public/docs/`
- `.mp3/.wav` → `public/audio/`
- Code files → root or src/

**Filename Sanitization:**
```javascript
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
```

## Testing Checklist

- [ ] Attach image → send message
- [ ] Verify file appears in Code tab under `public/images/`
- [ ] AI references `/images/filename.jpg` in generated code
- [ ] Preview shows the image
- [ ] File tree doesn't refresh while clicking

## Status

✅ **Phase 1:** File tree refresh fixed (deployed)  
🔄 **Phase 2:** Auto-save attachments (in progress)  
⏳ **Phase 3:** Smart path selection  
⏳ **Phase 4:** AI prompt enhancement

## Next Steps

1. Implement `/api/chats/:chatId/upload` endpoint
2. Wire ChatComposer to new endpoint
3. Update AI system prompt to mention saved files
4. Test end-to-end flow
