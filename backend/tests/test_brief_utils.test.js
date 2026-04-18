/**
 * Unit tests for normalizeFileContent / normalizeFiles.
 * Guards against the double-escape regression.
 */

import { normalizeFileContent, normalizeFiles, autoInjectMissingImports } from '../../lib/ai/brief-utils.js'

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

describe('autoInjectMissingImports', () => {
  test('injects useAuth import when bare useAuth() call exists in pages/*', () => {
    const input = 'export default function Signup() {\n  const { signup } = useAuth()\n  return null\n}'
    const out = autoInjectMissingImports('pages/Signup.jsx', input)
    expect(out).toContain("import { useAuth } from '../components/AuthContext'")
    expect(out).toContain('const { signup } = useAuth()')
  })

  test('skips injection when import already exists', () => {
    const input = "import { useAuth } from '../components/AuthContext'\nexport default function Signup() {\n  useAuth()\n}"
    const out = autoInjectMissingImports('pages/Signup.jsx', input)
    const matches = (out.match(/import \{ useAuth \}/g) || []).length
    expect(matches).toBe(1)
  })

  test('injects useMockAPI separately', () => {
    const input = 'export default function Chat() {\n  const api = useMockAPI()\n  return null\n}'
    const out = autoInjectMissingImports('pages/Chat.jsx', input)
    expect(out).toContain("import { useMockAPI } from '../components/MockAPIProvider'")
  })

  test('injects both when both are used', () => {
    const input = 'export default function X() {\n  useAuth()\n  useMockAPI()\n}'
    const out = autoInjectMissingImports('pages/X.jsx', input)
    expect(out).toContain('useAuth')
    expect(out).toContain('useMockAPI')
  })

  test('uses ./ path for components/ files', () => {
    const input = 'export default function Sidebar() {\n  const { user } = useAuth()\n}'
    const out = autoInjectMissingImports('components/Sidebar.jsx', input)
    expect(out).toContain("import { useAuth } from './AuthContext'")
  })

  test('never modifies AuthContext.jsx itself', () => {
    const input = 'export function useAuth() { return useContext(AuthContext) }'
    const out = autoInjectMissingImports('components/AuthContext.jsx', input)
    expect(out).toBe(input)
  })

  test('never modifies MockAPIProvider.jsx itself', () => {
    const input = 'export function useMockAPI() { return useContext(X) }'
    const out = autoInjectMissingImports('components/MockAPIProvider.jsx', input)
    expect(out).toBe(input)
  })

  test('skips files outside pages/ and components/', () => {
    const input = 'useAuth()'
    const out = autoInjectMissingImports('app/page.jsx', input)
    expect(out).toBe(input)
  })

  test('injects after existing imports', () => {
    const input = "import Navbar from './Navbar'\n\nexport default function X() {\n  useAuth()\n}"
    const out = autoInjectMissingImports('pages/X.jsx', input)
    const lines = out.split('\n')
    expect(lines[0]).toContain("Navbar")
    expect(lines[1]).toContain("useAuth")
  })

  test('idempotent — runs twice gives same result', () => {
    const input = 'useAuth()'
    const once = autoInjectMissingImports('pages/X.jsx', input)
    const twice = autoInjectMissingImports('pages/X.jsx', once)
    expect(once).toBe(twice)
  })

  test('normalizeFiles pipeline applies auto-inject', () => {
    const files = [{ path: 'pages/Signup.jsx', content: 'export default function Signup() { useAuth() }' }]
    const out = normalizeFiles(files)
    expect(out[0].content).toContain("import { useAuth }")
  })
})
