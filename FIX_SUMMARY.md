# Dashboard.jsx Fixes Required

## Issues Found:
1. Missing setters from useDashboardStream destructuring (line 696-706):
   - `setStreamingMessageId`
   - `setStreamingStatus`
   - `setImageGenProgress`

2. Bare `prompt()` call at line 1374 needs `window.` prefix

3. Variable name conflict: `prompt` used in generateVariation function

## Solution:
All three issues must be fixed in a single edit because:
- The syntax gate runs on the RESULT of the edit
- Each edit starts from the original file (not cumulative)
- All three errors must be resolved simultaneously

## Next Step:
Create a single comprehensive edit that fixes all three issues.
