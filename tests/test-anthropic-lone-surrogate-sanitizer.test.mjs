/**
 * Regression test for the 2026-05-28 Anthropic 400 outage:
 *   "The request body is not valid JSON: no low surrogate in string:
 *    line 1 column 4478 (char 4477)"
 *
 * Cause: a lone UTF-16 surrogate (high surrogate without paired low,
 * or vice versa) ended up in an outgoing string. Anthropic's strict
 * JSON validator rejects request bodies with unpaired surrogates and
 * the entire chat request 400s. The user's chat returned the literal
 * error string from agent-core's fallback retry path; on subsequent
 * model retries, garbled one-word responses appeared (the model's
 * context being broken by the malformed prior turn).
 *
 * Source of the lone surrogates: any of our string-slicing operations
 * (context-compactor history truncation, image-replay-stripper,
 * stream-handler-v2 tail trimming, addLineNumbers truncation) can
 * split a surrogate pair if the slice index lands mid-pair. JavaScript
 * strings are UTF-16, supplementary chars (emoji, many CJK glyphs,
 * mathematical symbols, …) are stored as PAIRS, so slice(0, N) is
 * surrogate-pair-unsafe.
 *
 * Fix: a sanitizer at the LAST hop before Anthropic gets the payload.
 * stripLoneSurrogates() replaces any unpaired surrogate with U+FFFD
 * (REPLACEMENT CHARACTER, the WHATWG-recommended fallback).
 * sanitizeDeep() walks messages/system/tools and applies the cleaner
 * to every string.
 *
 * Belt + suspenders: even if we patched every upstream slice() call,
 * the LAST-MILE cleaner here means any future slice() mistake also
 * can't cause this 400. Single point of defense, zero new dependencies.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __test__ } from '../lib/ai/providers/anthropic.js'

const { stripLoneSurrogates, sanitizeDeep } = __test__

// A few specific test fixtures.
//   '\uD83D\uDE00' = 😀 (valid surrogate pair, U+1F600)
//   '\uD83D'       = lone high surrogate (invalid alone)
//   '\uDE00'       = lone low surrogate (invalid alone)
const EMOJI = '\uD83D\uDE00'
const LONE_HIGH = '\uD83D'
const LONE_LOW = '\uDE00'
const REPLACEMENT = '\uFFFD'

test('stripLoneSurrogates: leaves plain ASCII alone', () => {
  assert.equal(stripLoneSurrogates('hello world'), 'hello world')
  assert.equal(stripLoneSurrogates(''), '')
})

test('stripLoneSurrogates: leaves valid surrogate pairs alone (emoji)', () => {
  assert.equal(stripLoneSurrogates(`hello ${EMOJI} world`), `hello ${EMOJI} world`)
  assert.equal(stripLoneSurrogates(`${EMOJI}${EMOJI}${EMOJI}`), `${EMOJI}${EMOJI}${EMOJI}`)
})

test('stripLoneSurrogates: replaces lone HIGH surrogate (the classic emoji-slice break)', () => {
  // This is what happens when you slice() a string mid-emoji:
  //   'hi 😀 there'.slice(0, 5) === 'hi \uD83D' — lone high surrogate.
  const broken = `hi ${LONE_HIGH}`
  assert.equal(stripLoneSurrogates(broken), `hi ${REPLACEMENT}`)
})

test('stripLoneSurrogates: replaces lone LOW surrogate', () => {
  const broken = `${LONE_LOW} world`
  assert.equal(stripLoneSurrogates(broken), `${REPLACEMENT} world`)
})

test('stripLoneSurrogates: handles a real slice() mid-emoji', () => {
  // Reproduce the actual production failure: history truncation hit
  // the high surrogate of an emoji at the slice boundary.
  const original = `Some long history with ${EMOJI} in the middle and more text after`
  // slice() at an index that falls between the two surrogate units.
  const emojiStart = original.indexOf(EMOJI)
  // Slice right between the high and low surrogate — surrogate-unsafe.
  const sliced = original.slice(0, emojiStart + 1)
  // Verify our fixture actually produces a lone surrogate (sanity).
  assert.equal(sliced[sliced.length - 1], LONE_HIGH)
  // Cleaned version: lone high → U+FFFD.
  const cleaned = stripLoneSurrogates(sliced)
  assert.equal(cleaned[cleaned.length - 1], REPLACEMENT)
})

test('stripLoneSurrogates: non-string passes through unchanged', () => {
  assert.equal(stripLoneSurrogates(undefined), undefined)
  assert.equal(stripLoneSurrogates(null), null)
  assert.equal(stripLoneSurrogates(42), 42)
  assert.deepEqual(stripLoneSurrogates({}), {})
})

test('sanitizeDeep: scrubs strings inside Anthropic-shaped messages', () => {
  const dirty = [
    { role: 'system', content: `instructions ${LONE_HIGH}` },
    {
      role: 'user',
      content: [
        { type: 'text', text: `hi ${LONE_LOW}` },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo' } },
      ],
    },
  ]
  const cleaned = sanitizeDeep(dirty)
  assert.equal(cleaned[0].content, `instructions ${REPLACEMENT}`)
  assert.equal(cleaned[1].content[0].text, `hi ${REPLACEMENT}`)
  // Image base64 data is plain ASCII — must not be touched.
  assert.equal(cleaned[1].content[1].source.data, 'iVBORw0KGgo')
})

test('sanitizeDeep: leaves clean payload unchanged (no allocation)', () => {
  const clean = [
    { role: 'system', content: 'just plain text' },
    { role: 'user', content: [{ type: 'text', text: `with valid emoji ${EMOJI}` }] },
  ]
  const result = sanitizeDeep(clean)
  // Identity check — performance matters; we should not allocate
  // a new array/object when nothing changed.
  assert.strictEqual(result, clean, 'identity preserved when no changes needed')
  assert.strictEqual(result[1].content, clean[1].content)
})

test('sanitizeDeep: handles deeply nested tool_result content', () => {
  const dirty = {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_xyz',
        content: `tool returned: ${LONE_HIGH} something`,
      },
    ],
  }
  const cleaned = sanitizeDeep(dirty)
  assert.equal(cleaned.content[0].content, `tool returned: ${REPLACEMENT} something`)
})

test('sanitizeDeep: walks system field whether string or content-block array', () => {
  // String form (caching disabled).
  assert.equal(
    sanitizeDeep(`sys ${LONE_HIGH}`),
    `sys ${REPLACEMENT}`,
  )
  // Content-block array form (caching enabled — the cache_control marker case).
  const cleaned = sanitizeDeep([
    { type: 'text', text: `cached sys ${LONE_LOW}`, cache_control: { type: 'ephemeral' } },
  ])
  assert.equal(cleaned[0].text, `cached sys ${REPLACEMENT}`)
  // cache_control.type is plain ASCII — must remain untouched.
  assert.equal(cleaned[0].cache_control.type, 'ephemeral')
})

test('sanitizeDeep: handles long base64 image data URLs without touching them', () => {
  // Pathological case: a 200KB base64 data URL must not get touched
  // or partially mutated. base64 is ASCII-only by construction.
  const longB64 = 'data:image/png;base64,' + 'A'.repeat(200_000)
  const dirty = [{ role: 'user', content: [{ type: 'text', text: longB64 }] }]
  const cleaned = sanitizeDeep(dirty)
  assert.strictEqual(cleaned, dirty, 'identity preserved (no surrogates means no walk)')
  assert.equal(cleaned[0].content[0].text.length, longB64.length)
})
