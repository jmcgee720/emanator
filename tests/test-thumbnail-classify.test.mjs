/**
 * Test: classifyProject({ skipNodeDetection: true }) lets the dashboard
 * thumbnail builder fall through to 'react' for projects that have a
 * package.json (which is nearly every real project).
 *
 * Without this option, the classifier returns type:'node' first and the
 * thumbnail builder bails out, leaving the grid full of "No files yet"
 * placeholders even for non-empty projects.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync('/app/components/dashboard/tabs/PreviewTab.jsx', 'utf8')

// Source must accept the option
assert.ok(
  src.includes('skipNodeDetection'),
  'classifyProject must accept { skipNodeDetection: true }'
)
assert.ok(
  src.includes('hasPackageJson && !options.skipNodeDetection'),
  'package.json early-return must be guarded by !skipNodeDetection'
)
console.log('OK classifyProject accepts skipNodeDetection option')

const gridSrc = fs.readFileSync('/app/components/dashboard/ProjectGrid.jsx', 'utf8')

assert.ok(
  gridSrc.includes("classifyProject(files, { skipNodeDetection: true })"),
  'ProjectGrid must pass skipNodeDetection: true to classifyProject'
)
console.log('OK ProjectGrid passes skipNodeDetection: true')

assert.ok(
  gridSrc.includes('THUMBNAIL_CODE_FILE_LIMIT'),
  'ProjectGrid must use the new code-file-only limit, not raw files count'
)
assert.ok(
  /THUMBNAIL_CODE_FILE_LIMIT\s*=\s*120/.test(gridSrc),
  'thumbnail code-file limit should be raised to 120 (was 30 — too tight)'
)
console.log('OK thumbnail file-size cap measures CODE files only and is high enough')

console.log('\nAll thumbnail classification checks passed.')
