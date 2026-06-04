# Comprehensive Fix Plan

## Issues to fix in Dashboard.jsx:

1. **Line 699**: Add `setStreamingMessageId, setStreamingStatus` after `streamingMessageId, streamingStatus`
2. **Line 706**: Add `setImageGenProgress` after `imageGenProgress`
3. **Line 1374**: Change `prompt('Rename conversation:',` to `window.prompt('Rename conversation:',`
4. **Line 884**: Rename variable `prompt` to `promptText`
5. **Line 893**: Change `prompt,` to `prompt: promptText,`
6. **Line 969**: Change `${prompt.slice(0, 200)}` to `${promptText.slice(0, 200)}`
7. **Lines 1386-1413**: Remove duplicate toolbar

All fixes must be applied in ONE edit to pass the syntax gate.
