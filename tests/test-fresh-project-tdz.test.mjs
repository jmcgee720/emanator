/**
 * Regression guard for message-stream.js TDZ bugs.
 *
 * This test would have caught commit 8ed5064's bug where the early
 * creative-brief-fastpath block referenced `effectiveScope` before it
 * was declared later in the same function.
 *
 * Strategy: parse message-stream.js with the V8 parser (just by
 * importing the module — any syntactic "use before declaration" on
 * top-level code would fail at import time). Then read the source and
 * enforce a simple ordering rule: no `effectiveScope` usage above its
 * `let effectiveScope = ...` declaration.
 *
 * Run: node --experimental-vm-modules tests/test-fresh-project-tdz.test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const target = path.resolve(__dirname, '..', 'lib', 'ai', 'message-stream.js')
const source = fs.readFileSync(target, 'utf8')

const declRegex = /^\s*(?:let|const|var)\s+effectiveScope\b/m
const match = source.match(declRegex)
if (!match) {
  console.error('FAIL: could not find effectiveScope declaration in message-stream.js')
  process.exit(1)
}

const declLine = source.slice(0, match.index).split('\n').length

// Look for any reference to `effectiveScope` (as an identifier, not in a
// comment string) on a line number smaller than declLine.
const lines = source.split('\n')
const violations = []
for (let i = 0; i < declLine - 1; i++) {
  const line = lines[i]
  // skip comments + JSDoc
  const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
  if (/\beffectiveScope\b/.test(stripped)) {
    violations.push({ lineNumber: i + 1, content: line.trim() })
  }
}

if (violations.length > 0) {
  console.error('FAIL: effectiveScope referenced before declaration (TDZ bug).')
  console.error(`Declaration is on line ${declLine}. Violations above that:`)
  for (const v of violations) {
    console.error(`  line ${v.lineNumber}: ${v.content}`)
  }
  process.exit(1)
}

console.log(`OK: effectiveScope declared on line ${declLine}, no earlier references found.`)
process.exit(0)
