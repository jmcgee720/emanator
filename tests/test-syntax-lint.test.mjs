// ──────────────────────────────────────────────────────────────────────
// Pre-commit syntax-lint — unit tests
// ──────────────────────────────────────────────────────────────────────
// Pins the gate that stops the self-edit agent from committing broken
// JS / JSX / TS / TSX / JSON to main. Regression here = the bracket-
// mismatch bug that takes the live site down for the duration of a
// Vercel build cycle.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syntaxLintBeforeCommit } from '../lib/ai/syntax-lint.js'

test('lint: valid JSX passes', () => {
  const ok = `
import React from 'react'
export default function Hello({ name }) {
  return <div className="x">{name}</div>
}
`
  assert.equal(syntaxLintBeforeCommit('app/Hello.jsx', ok), null)
})

test('lint: TypeScript + decorators passes', () => {
  const ok = `
type X = { a: number, b?: string }
export const f = (x: X): number => x.a + 1
class Foo { private x = 1; bar(): void {} }
`
  assert.equal(syntaxLintBeforeCommit('lib/x.ts', ok), null)
})

test('lint: blocks unclosed JSX tag', () => {
  const bad = `
export default function Bad() {
  return <div className="x">missing close
}
`
  const err = syntaxLintBeforeCommit('app/Bad.jsx', bad)
  assert.ok(err, 'must return an error string')
  assert.match(err, /Syntax error in app\/Bad\.jsx/)
  assert.match(err, /commit was blocked/)
})

test('lint: blocks mismatched braces', () => {
  const bad = `
export function foo() {
  if (true) {
    return 1
  // missing close
}
`
  const err = syntaxLintBeforeCommit('lib/foo.js', bad)
  assert.ok(err, 'must return an error string')
  assert.match(err, /Syntax error/)
})

test('lint: blocks stray comma in object literal that breaks parse', () => {
  const bad = `
const config = {
  foo: 1,,
  bar: 2,
}
export default config
`
  const err = syntaxLintBeforeCommit('next.config.js', bad)
  assert.ok(err, 'must return an error string')
})

test('lint: blocks malformed JSON', () => {
  const bad = '{ "name": "x", "version": 1.0.0 }'
  const err = syntaxLintBeforeCommit('package.json', bad)
  assert.ok(err)
  assert.match(err, /Invalid JSON in package\.json/)
})

test('lint: allows valid JSON', () => {
  const ok = JSON.stringify({ name: 'x', deps: ['a', 'b'] }, null, 2)
  assert.equal(syntaxLintBeforeCommit('package.json', ok), null)
})

test('lint: skips non-code files (CSS, MD, PNG)', () => {
  assert.equal(syntaxLintBeforeCommit('app/style.css', 'body { color: { broken'), null)
  assert.equal(syntaxLintBeforeCommit('README.md', '# title\n\n**bold but [unclosed link'), null)
  assert.equal(syntaxLintBeforeCommit('assets/logo.png', 'definitely not valid utf-8 source'), null)
})

test('lint: empty content passes (deletion / clear-out)', () => {
  assert.equal(syntaxLintBeforeCommit('app/x.js', ''), null)
})

test('lint: includes line/column when babel reports them', () => {
  const bad = `function foo() {\n  return 1\n  bad syntax here !!!\n}\n`
  const err = syntaxLintBeforeCommit('lib/foo.js', bad)
  assert.ok(err)
  // Should include "line N" since babel reports a position
  assert.match(err, /line \d+/)
})

test('lint: handles non-string filePath gracefully (defensive)', () => {
  assert.equal(syntaxLintBeforeCommit(null, 'const x = 1'), null)
  assert.equal(syntaxLintBeforeCommit('', 'const x = 1'), null)
})

test('lint: handles non-string content gracefully (defensive)', () => {
  assert.equal(syntaxLintBeforeCommit('lib/x.js', null), null)
  assert.equal(syntaxLintBeforeCommit('lib/x.js', undefined), null)
})

test('lint: allows top-level await (modern ESM)', () => {
  const ok = `
const data = await fetch('/api/health').then((r) => r.json())
export default data
`
  assert.equal(syntaxLintBeforeCommit('lib/await.mjs', ok), null)
})

test('lint: allows class private fields (modern JS)', () => {
  const ok = `
export class Counter {
  #count = 0
  inc() { this.#count++ }
  get value() { return this.#count }
}
`
  assert.equal(syntaxLintBeforeCommit('lib/counter.js', ok), null)
})
