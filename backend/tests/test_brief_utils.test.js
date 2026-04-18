/**
 * Unit tests for normalizeFileContent / normalizeFiles.
 * Guards against the double-escape regression.
 */

import { normalizeFileContent, normalizeFiles } from '../../lib/ai/brief-utils.js'

describe('normalizeFileContent', () => {
  test('pass-through when content already has real newlines', () => {
    const input = 'export default function X() {\n  return null\n}'
    expect(normalizeFileContent(input)).toBe(input)
  })

  test('unescapes double-escaped newlines (the repair-wave bug)', () => {
    const input = 'export default function X() {\\n  return null\\n}'
    expect(normalizeFileContent(input)).toBe('export default function X() {\n  return null\n}')
  })

  test('unescapes \\r\\n pairs first (Windows-style)', () => {
    const input = 'line1\\r\\nline2\\r\\nline3'
    expect(normalizeFileContent(input)).toBe('line1\nline2\nline3')
  })

  test('unescapes tabs and quotes when double-escaped', () => {
    const input = 'const x = {\\n\\t"key": \\"value\\"\\n}'
    const output = normalizeFileContent(input)
    expect(output).toContain('\n')
    expect(output).toContain('\t')
    expect(output).toContain('"key"')
  })

  test('empty string passes through', () => {
    expect(normalizeFileContent('')).toBe('')
  })

  test('non-string passes through unchanged', () => {
    expect(normalizeFileContent(null)).toBe(null)
    expect(normalizeFileContent(undefined)).toBe(undefined)
  })

  test('content with BOTH real newlines AND literal \\n (mixed) is NOT touched', () => {
    // If there are already real newlines, we assume content is fine and leave it.
    const input = 'line1\nline2 with \\n inside a string literal'
    expect(normalizeFileContent(input)).toBe(input)
  })

  test('idempotent — running twice gives same result', () => {
    const bad = 'a\\nb\\nc'
    const once = normalizeFileContent(bad)
    const twice = normalizeFileContent(once)
    expect(once).toBe('a\nb\nc')
    expect(twice).toBe('a\nb\nc')
  })
})

describe('normalizeFiles', () => {
  test('normalizes every file in array', () => {
    const files = [
      { path: 'a.jsx', content: 'a\\nb' },
      { path: 'b.jsx', content: 'real\nnewlines' },
    ]
    const out = normalizeFiles(files)
    expect(out[0].content).toBe('a\nb')
    expect(out[1].content).toBe('real\nnewlines')
  })

  test('returns empty array for non-array input', () => {
    expect(normalizeFiles(null)).toEqual([])
    expect(normalizeFiles(undefined)).toEqual([])
  })

  test('preserves path and extra metadata', () => {
    const out = normalizeFiles([{ path: 'x.jsx', content: 'a\\nb', action: 'create', extra: 1 }])
    expect(out[0]).toEqual({ path: 'x.jsx', content: 'a\nb', action: 'create', extra: 1 })
  })
})
