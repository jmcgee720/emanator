/**
 * Regression test for the 2026-05-22 priorMessages outage.
 *
 * On that date the Core System agent edited stream-handler-v2.js to add
 * a "historical attachments" feature and in the process deleted the
 *   let priorMessages = await loadPriorMessages(...)
 * declaration. The dangling references downstream made V8 throw
 *   ReferenceError: priorMessages is not defined
 * crashing every project chat for ~12 hours.
 *
 * The pre-commit syntaxLintBeforeCommit only checked parse-level
 * errors at that time, so the broken commit landed cleanly. We've
 * extended it with an AST-based undeclared-identifier (no-undef)
 * scope check. This test pins the new behaviour:
 *   • valid code with all references in scope → passes
 *   • the literal priorMessages-style bug → blocks the commit
 *   • known globals (process, fetch, console …) → never flagged
 *   • imports, function params, destructuring → all bind properly
 *   • TypeScript files → skipped (resolution out of scope here)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syntaxLintBeforeCommit } from '../lib/ai/syntax-lint.js'

test('passes valid code with declarations + references in scope', () => {
  const code = `
    import { foo } from 'bar'
    export function handler({ chatId }) {
      let priorMessages = []
      const result = foo(chatId, priorMessages)
      return result
    }
  `
  const err = syntaxLintBeforeCommit('lib/api/handler.js', code)
  assert.equal(err, null, `expected pass, got: ${err}`)
})

test('BLOCKS the 2026-05-22 priorMessages-deleted-declaration bug', () => {
  // Mirrors the actual production bug — declaration was deleted but
  // five references remained downstream. This is the regression we're
  // preventing.
  const code = `
    export async function handler(db, chatId) {
      const tools = []
      // let priorMessages = await loadPriorMessages(...)   <- deleted!
      const compacted = await summarize(priorMessages)
      console.log(priorMessages.length)
      if (priorMessages.length > 0) {
        priorMessages = compacted
      }
      return runAgent({ priorMessages, tools })
    }
  `
  const err = syntaxLintBeforeCommit('lib/api/stream-handler-v2.js', code)
  assert.ok(err, 'must block this commit')
  assert.match(err, /priorMessages/, 'error names the undeclared identifier')
  assert.match(err, /Undeclared identifier|never declared/i, 'error explains the class of problem')
})

test('does NOT flag well-known globals (process, fetch, console, Buffer …)', () => {
  const code = `
    export function ping() {
      console.log(process.env.NODE_ENV)
      return fetch('https://api.example.com').then(r => r.json())
    }
    export function bin(s) {
      return Buffer.from(s, 'utf-8').toString('base64')
    }
    setTimeout(() => crypto.randomUUID(), 100)
  `
  const err = syntaxLintBeforeCommit('lib/util.js', code)
  assert.equal(err, null, `unexpected error: ${err}`)
})

test('does NOT flag imports / function params / destructuring', () => {
  const code = `
    import { NextResponse } from 'next/server'
    import db from '@/lib/mongodb'
    export async function POST(request, { params }) {
      const { chatId } = params
      const { content, metadata = {} } = await request.json()
      const { user, error } = await db.users.findById(chatId)
      if (error) return NextResponse.json({ error }, { status: 500 })
      return NextResponse.json({ user, content, metadata })
    }
  `
  const err = syntaxLintBeforeCommit('app/api/foo/route.js', code)
  assert.equal(err, null, `unexpected error: ${err}`)
})

test('does NOT flag class methods + this references', () => {
  const code = `
    export class Foo {
      constructor(name) {
        this.name = name
      }
      greet() {
        return 'Hello, ' + this.name
      }
    }
  `
  const err = syntaxLintBeforeCommit('lib/foo.js', code)
  assert.equal(err, null, `unexpected error: ${err}`)
})

test('does NOT flag JSX components (capitalised — may be siblings)', () => {
  const code = `
    export default function Page() {
      return (
        <div>
          <SomeUnimportedComponent foo="bar" />
        </div>
      )
    }
  `
  // We choose to under-flag JSX components to avoid false positives.
  const err = syntaxLintBeforeCommit('app/page.jsx', code)
  assert.equal(err, null, `unexpected error: ${err}`)
})

test('SKIPS TypeScript files (.ts / .tsx)', () => {
  const code = `
    export function broken() {
      return priorMessages.length
    }
  `
  assert.equal(syntaxLintBeforeCommit('lib/x.ts', code), null)
  assert.equal(syntaxLintBeforeCommit('app/x.tsx', code), null)
})

test('still catches syntax errors before the scope check runs', () => {
  const code = `
    export function broken( {
      return 'syntax error above'
    }
  `
  const err = syntaxLintBeforeCommit('lib/x.js', code)
  assert.ok(err, 'must block')
  assert.match(err, /Syntax error/i)
})

test('still catches malformed JSON', () => {
  const err = syntaxLintBeforeCommit('package.json', '{ "name": broken }')
  assert.ok(err, 'must block')
  assert.match(err, /Invalid JSON/i)
})

test('non-JS-like extensions (.md, .css) are not checked', () => {
  assert.equal(syntaxLintBeforeCommit('README.md', 'priorMessages is undeclared but who cares'), null)
  assert.equal(syntaxLintBeforeCommit('styles.css', '.x { color: red }'), null)
})

test('multiple undeclared identifiers — first 5 distinct names reported', () => {
  const code = `
    function f() {
      return alphaa + betaa + gammaa + deltaa + epsilonn + zetaa + etaa
    }
  `
  const err = syntaxLintBeforeCommit('lib/x.js', code)
  assert.ok(err)
  // Expect at most 5 distinct identifiers listed in the message
  const matches = err.match(/'[a-z]+'/g) || []
  assert.ok(matches.length <= 5, `report should cap at 5 names, got ${matches.length}: ${err}`)
  assert.ok(matches.length >= 3, `report should list at least 3: ${matches.length}`)
})

test('CommonJS-style require + module.exports work without false positives', () => {
  const code = `
    const path = require('path')
    function helper(s) { return path.join(s, 'x') }
    module.exports = helper
  `
  const err = syntaxLintBeforeCommit('lib/x.cjs', code)
  assert.equal(err, null, `unexpected error: ${err}`)
})
