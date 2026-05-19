// ──────────────────────────────────────────────────────────────────────
// write_file binary-payload tripwire — unit tests
// ──────────────────────────────────────────────────────────────────────
// The agent used to silently corrupt user-uploaded artwork by smuggling
// base64 image data through the text-only write_file tool. The tool
// would happily store "data:image/png;base64,iVBOR..." as the file's
// content; the Fly runner would then sync that string verbatim to disk
// (60 bytes, never the real 412 KB image), and Vite would 200 the
// request with broken bytes. This test pins the tripwire so write_file
// loudly refuses base64 / data-URL payloads and tells the model to use
// save_attachment_to_path instead.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileTool } from '../lib/ai/agent-tools-v2.js'

const SCOPE = { rootDirs: ['/project-test'], excludePaths: [] }

function fakeWriter() {
  const writes = []
  return {
    writes,
    isConfigured: true,
    repo: 'fake/project',
    branch: 'project',
    async writeFile(p, c) {
      writes.push({ p, c })
      return `Wrote ${p} (${c.length} bytes)`
    },
  }
}

test('write_file: rejects a data: URL with a clear pointer to save_attachment_to_path', async () => {
  const writer = fakeWriter()
  const tool = writeFileTool(SCOPE, writer)
  await assert.rejects(
    () => tool.execute({
      path: 'frontend/public/assets/logo.png',
      content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    }),
    /save_attachment_to_path/,
  )
  assert.equal(writer.writes.length, 0, 'must NOT write the corrupt content to project files')
})

test('write_file: rejects raw base64 payload (no data: prefix) over 2KB', async () => {
  const writer = fakeWriter()
  const tool = writeFileTool(SCOPE, writer)
  // 3000 chars of pure base64 alphabet (length is a multiple of 4
  // exactly as real base64 padding produces) → clearly a binary,
  // never source code.
  const rawB64 = 'A'.repeat(3000)
  await assert.rejects(
    () => tool.execute({ path: 'frontend/x.png', content: rawB64 }),
    /save_attachment_to_path/,
  )
  assert.equal(writer.writes.length, 0)
})

test('write_file: allows normal source code through (false-positive guard)', async () => {
  const writer = fakeWriter()
  const tool = writeFileTool(SCOPE, writer)
  const realCode = `import React from 'react'\nexport default function Foo() {\n  return <div className="logo">Hello</div>\n}\n`
  const result = await tool.execute({ path: 'frontend/src/Foo.jsx', content: realCode })
  assert.equal(writer.writes.length, 1, 'normal code must still write')
  assert.match(result, /bytes/)
})

test('write_file: allows long JSON / config files through (false-positive guard)', async () => {
  const writer = fakeWriter()
  const tool = writeFileTool(SCOPE, writer)
  // Long but contains characters outside the base64 alphabet
  // ({, }, :, ", spaces, newlines) so the heuristic must not match.
  const longJson = JSON.stringify({ packages: Array.from({ length: 500 }, (_, i) => ({ name: `pkg-${i}`, version: '1.2.3' })) }, null, 2)
  const result = await tool.execute({ path: 'frontend/package.json', content: longJson })
  assert.equal(writer.writes.length, 1, 'long config must still write')
  assert.match(result, /bytes/)
})

test('write_file: allows a short base64-looking string (under tripwire threshold)', async () => {
  // Encoded credentials, JWTs, short hashes etc. live under 2KB and
  // should not trip the binary heuristic.
  const writer = fakeWriter()
  const tool = writeFileTool(SCOPE, writer)
  const shortToken = 'A'.repeat(1500) + '=='
  const result = await tool.execute({ path: 'frontend/.env.example', content: shortToken })
  assert.equal(writer.writes.length, 1, 'short base64-looking content under 2KB should not trip')
  assert.match(result, /bytes/)
})
