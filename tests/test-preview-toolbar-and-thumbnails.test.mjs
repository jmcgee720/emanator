/**
 * Regression test: preview toolbar UX
 *
 *  - Single Refresh button (no duplicate outer one in PreviewTab)
 *  - Reset node_modules button wired to /api/previews/:id/reset-node-modules
 *  - Update Thumbnail button wired to /api/projects/:id/thumbnail-refresh
 *  - Runner exposes POST /reset-node-modules
 *  - Server endpoints exist
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const previewTab = fs.readFileSync('/app/components/dashboard/tabs/PreviewTab.jsx', 'utf8')
const serverPreview = fs.readFileSync('/app/components/dashboard/tabs/ServerPreview.jsx', 'utf8')
const runner = fs.readFileSync('/app/preview-runner/index.js', 'utf8')
const grid = fs.readFileSync('/app/components/dashboard/ProjectGrid.jsx', 'utf8')

// 1. PreviewTab no longer renders its own Refresh button — ServerPreview owns it
const outerRefreshCount = (previewTab.match(/data-testid="preview-refresh"/g) || []).length
assert.equal(outerRefreshCount, 0,
  'PreviewTab must NOT render a duplicate outer Refresh button (ServerPreview owns it)'
)
console.log('OK PreviewTab has no duplicate outer Refresh button')

// 2. ServerPreview has exactly ONE Refresh button
const innerRefreshCount = (serverPreview.match(/data-testid="server-preview-refresh"/g) || []).length
assert.equal(innerRefreshCount, 1,
  'ServerPreview must render exactly one Refresh button'
)
console.log('OK ServerPreview has one Refresh button')

// 3. Reset node_modules button + endpoint wiring
assert.match(serverPreview, /data-testid="server-preview-reset-node-modules"/,
  'ServerPreview must render the Reset node_modules button'
)
assert.match(serverPreview, /\/api\/previews\/\$\{projectId\}\/reset-node-modules/,
  'ServerPreview must call POST /api/previews/:projectId/reset-node-modules'
)
assert.ok(fs.existsSync('/app/app/api/previews/[projectId]/reset-node-modules/route.js'),
  'reset-node-modules Next.js route must exist'
)
console.log('OK Reset node_modules button + endpoint wired')

// 4. Runner exposes POST /reset-node-modules
assert.match(runner, /app\.post\(['"]\/reset-node-modules['"]/,
  'Runner must expose POST /reset-node-modules'
)
assert.match(runner, /reset-node-modules\] removing/,
  'Runner endpoint must wipe node_modules'
)
console.log('OK Runner exposes /reset-node-modules and wipes the dir')

// 5. Update Thumbnail button + endpoints (Workstream 4)
assert.match(serverPreview, /data-testid="server-preview-capture-thumbnail"/,
  'ServerPreview must render the Update Thumbnail button'
)
assert.match(serverPreview, /\/api\/projects\/\$\{projectId\}\/thumbnail-refresh/,
  'Update Thumbnail button must call the thumbnail-refresh endpoint'
)
assert.ok(fs.existsSync('/app/app/api/projects/[projectId]/thumbnail-refresh/route.js'),
  'thumbnail-refresh endpoint must exist'
)
assert.ok(fs.existsSync('/app/app/api/projects/[projectId]/thumbnail/route.js'),
  'thumbnail GET endpoint must exist'
)
console.log('OK Update Thumbnail button + endpoints wired')

// 6. Auto-capture on preview ready (Workstream 4)
assert.match(serverPreview, /capturedThisSessionRef/,
  'ServerPreview must auto-capture thumbnail once per session'
)
assert.match(serverPreview, /auroraly:thumbnail-updated/,
  'ServerPreview must dispatch the auroraly:thumbnail-updated event'
)
console.log('OK auto-capture with thumbnail-updated event dispatch')

// 7. Dashboard grid uses screenshot preferentially over Babel snapshot
assert.match(grid, /screenshotUrl/,
  'ProjectGrid must read the stored thumbnail screenshot'
)
assert.match(grid, /if \(screenshotUrl\) \{/,
  'ProjectGrid must render screenshot with priority over Babel snapshot'
)
assert.match(grid, /auroraly:thumbnail-updated/,
  'ProjectGrid must live-refresh on the thumbnail-updated event'
)
console.log('OK ProjectGrid uses live screenshot with priority')

console.log('\nAll preview toolbar + thumbnail pipeline checks passed.')
