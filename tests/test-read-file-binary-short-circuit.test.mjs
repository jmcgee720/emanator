/**
 * Regression test for the 2026-05-28 "Auroraly reads base64 instead
 * of looking at uploaded image" outage.
 *
 * User report (Core System + project chats): when a screenshot was
 * uploaded, the agent saved it to the project filesystem and then
 * called read_file on its saved path. The reader returned the
 * data:image/png;base64,iVBORw0KGgoAAAANSUhEUg… string (truncated at
 * 200KB) and the model narrated "I can see the screenshot is a PNG
 * image file" and then proceeded to FABRICATE the contents from the
 * filename and surrounding context. Meanwhile the actual image bytes
 * were already passed to Claude as a vision content block — the
 * model just preferred the read_file output over the vision input.
 *
 * Fix: read_file now short-circuits on base64 data URLs (any media
 * type), returning a sharp message that points the model at the
 * vision input it already received. The base64 itself is never
 * surfaced to the model.
 *
 * Tested via the project-fs reader path (where uploads land) and the
 * local-fs reader path. The GitHub-reader path uses the same code so
 * is also covered.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileTool } from '../lib/ai/agent-tools-v2.js'

/** Minimal in-memory reader for tests — same shape as projectFs.readFile. */
function makeReader(contentByPath) {
  return {
    repo: 'project-test',
    branch: 'project',
    isConfigured: true,
    async readFile(reqPath, maxBytes = 200_000) {
      const raw = contentByPath[reqPath]
      if (raw === undefined) throw new Error(`"${reqPath}" not found`)
      const truncated = raw.length > maxBytes
      const content = truncated ? raw.slice(0, maxBytes) + `\n[truncated at ${maxBytes} bytes]` : raw
      return {
        content,
        lineCount: raw.split('\n').length,
        source: `project-test/${reqPath}`,
      }
    },
  }
}

const SCOPE = { rootDirs: ['/project-test'], excludePaths: [], maxFileBytes: 200_000 }

test('read_file short-circuits on base64 image data URL', async () => {
  // Simulates what the upload route stores for an uploaded screenshot:
  // a `data:image/png;base64,...` string as the file's content.
  const fakePng = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAB9w' + 'A'.repeat(50000)
  const reader = makeReader({
    'public/images/screenshot-2026-05-28-at-4.45.44-pm.png': fakePng,
  })
  const tool = readFileTool(SCOPE, reader)
  const result = await tool.execute({ path: 'public/images/screenshot-2026-05-28-at-4.45.44-pm.png' })
  assert.match(result, /BINARY FILE/, 'must flag binary')
  assert.match(result, /image\/png/, 'must name the media type')
  assert.match(result, /vision content block|look at it directly|do NOT attempt to interpret/i, 'must redirect to vision input')
  // The actual base64 must NEVER appear in the response — that's the
  // exact gibberish the model was misreading.
  assert.ok(
    !result.includes('iVBORw0KGgo'),
    'base64 payload must NOT be surfaced to the model',
  )
})

test('read_file short-circuits on base64 PDF data URL', async () => {
  const fakePdf = 'data:application/pdf;base64,' + 'JVBERi0xLjQK' + 'A'.repeat(40000)
  const reader = makeReader({
    'docs/contract.pdf': fakePdf,
  })
  const tool = readFileTool(SCOPE, reader)
  const result = await tool.execute({ path: 'docs/contract.pdf' })
  assert.match(result, /BINARY FILE/)
  assert.match(result, /application\/pdf/i)
  assert.match(result, /PDF|extracted text|text content block/i)
  assert.ok(!result.includes('JVBERi0xLjQK'))
})

test('read_file works normally on actual source files (text content)', async () => {
  // Sanity check — we haven't broken the common case.
  const reader = makeReader({
    'src/App.jsx': 'export default function App() {\n  return <div>hi</div>\n}\n',
  })
  const tool = readFileTool(SCOPE, reader)
  const result = await tool.execute({ path: 'src/App.jsx' })
  assert.match(result, /project-test\/src\/App\.jsx/, 'returns source path')
  assert.match(result, /export default function App/, 'returns actual file content')
  assert.match(result, /1\| export default function App/, 'addLineNumbers ran')
  assert.doesNotMatch(result, /BINARY FILE/, 'does not flag text as binary')
})

test('read_file handles JSON and markdown without binary false-positive', async () => {
  const reader = makeReader({
    'package.json': '{\n  "name": "test",\n  "version": "1.0.0"\n}\n',
    'README.md': '# Test\n\nThis is a readme that mentions data: URLs for completeness.\n',
  })
  const tool = readFileTool(SCOPE, reader)
  const pkg = await tool.execute({ path: 'package.json' })
  assert.doesNotMatch(pkg, /BINARY FILE/)
  assert.match(pkg, /"name": "test"/)
  const md = await tool.execute({ path: 'README.md' })
  assert.doesNotMatch(md, /BINARY FILE/)
  assert.match(md, /# Test/)
})

test('read_file handles SVG correctly (text-based, not binary)', async () => {
  // SVGs are XML text — read_file should return them as-is so the
  // model can edit them. Critical: an SVG starts with `<svg`, not
  // `data:`, so the binary short-circuit must not trigger.
  const reader = makeReader({
    'public/icons/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>',
  })
  const tool = readFileTool(SCOPE, reader)
  const result = await tool.execute({ path: 'public/icons/logo.svg' })
  assert.doesNotMatch(result, /BINARY FILE/)
  assert.match(result, /<svg xmlns/)
})

test('read_file flags data URL even when underlying reader truncates', async () => {
  // The data URL exceeds maxFileBytes; the reader appends a
  // [truncated at …] marker. The prefix `data:image/png;base64,`
  // is still at the start, so the short-circuit must still fire.
  const fakePng = 'data:image/png;base64,' + 'A'.repeat(300_000)
  const reader = makeReader({
    'public/images/huge.png': fakePng,
  })
  const tool = readFileTool(SCOPE, reader)
  const result = await tool.execute({ path: 'public/images/huge.png' })
  assert.match(result, /BINARY FILE/)
  assert.ok(!result.includes('AAAAAAAA'), 'base64 must not leak through')
})

test('error message gives the model a useful path hint for referencing the image in code', async () => {
  const fakePng = 'data:image/png;base64,XYZ'
  const reader = makeReader({
    'public/images/hero.png': fakePng,
  })
  const tool = readFileTool(SCOPE, reader)
  const result = await tool.execute({ path: 'public/images/hero.png' })
  // The hint should suggest using the path as-is for <img src=…>
  assert.match(result, /img src|reference|need to read the binary/, 'gives a useful path-reference hint')
})
