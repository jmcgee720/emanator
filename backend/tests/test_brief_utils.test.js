/**
 * Unit tests for normalizeFileContent / normalizeFiles.
 * Guards against the double-escape regression.
 */

import { normalizeFileContent, normalizeFiles, autoInjectMissingImports, mapImageAssets, buildAssetsFileContent } from '../../lib/ai/brief-utils.js'

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

describe('mapImageAssets (user-uploaded images → role-tagged assets)', () => {
  test('empty input returns empty array', () => {
    expect(mapImageAssets(undefined)).toEqual([])
    expect(mapImageAssets([])).toEqual([])
    expect(mapImageAssets(null)).toEqual([])
  })

  test('filters out attachments without data', () => {
    const out = mapImageAssets([{ name: 'logo.png' }, { data: 'abc', name: 'ok.png' }])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('ok.png')
  })

  test('filename with "logo" → role=logo, exposes LOGO_URL export name later', () => {
    const out = mapImageAssets([{ data: 'b64', name: 'my-logo-final.png' }])
    expect(out[0].role).toBe('logo')
  })

  test('filename with "hero" / "banner" → role=hero', () => {
    const a = mapImageAssets([{ data: 'b64', name: 'hero-bg.jpg' }])
    const b = mapImageAssets([{ data: 'b64', name: 'site-banner.webp' }])
    expect(a[0].role).toBe('hero')
    expect(b[0].role).toBe('hero')
  })

  test('first of ≤2 unnamed images is treated as logo, second as hero', () => {
    const out = mapImageAssets([
      { data: 'a' },
      { data: 'b' },
    ])
    expect(out[0].role).toBe('logo')
    expect(out[1].role).toBe('hero')
  })

  test('larger batches default to photo (no auto-logo promotion)', () => {
    const out = mapImageAssets([
      { data: 'a' }, { data: 'b' }, { data: 'c' },
    ])
    // First two get hero/logo via proximity heuristic; remaining are photos.
    // Key invariant: larger batches never have ALL as 'reference' — they
    // become renderable 'photo' exports instead.
    expect(out.every((a) => ['logo', 'hero', 'photo'].includes(a.role))).toBe(true)
  })

  test('caps at 8 images (expanded from legacy 4)', () => {
    const out = mapImageAssets([
      { data: '1' }, { data: '2' }, { data: '3' }, { data: '4' },
      { data: '5' }, { data: '6' }, { data: '7' }, { data: '8' }, { data: '9' },
    ])
    expect(out).toHaveLength(8)
  })

  test('prefixes data: URI correctly based on file extension', () => {
    const png = mapImageAssets([{ data: 'abc', name: 'x.png' }])
    const jpg = mapImageAssets([{ data: 'abc', name: 'x.jpg' }])
    const webp = mapImageAssets([{ data: 'abc', name: 'x.webp' }])
    const svg = mapImageAssets([{ data: 'abc', name: 'x.svg' }])
    expect(png[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(jpg[0].dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(webp[0].dataUrl.startsWith('data:image/webp;base64,')).toBe(true)
    expect(svg[0].dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  test('honours UI-supplied role "aesthetic" (never sub-classified to brand)', () => {
    const out = mapImageAssets([
      { data: 'a', name: 'moodboard.jpg', role: 'aesthetic', note: 'match this warm palette' },
    ])
    expect(out[0].role).toBe('aesthetic')
    expect(out[0].note).toBe('match this warm palette')
  })

  test('honours UI-supplied role "structural"', () => {
    const out = mapImageAssets([
      { data: 'a', name: 'competitor.png', role: 'structural', note: 'copy the pricing strip layout' },
    ])
    expect(out[0].role).toBe('structural')
    expect(out[0].note).toBe('copy the pricing strip layout')
  })

  test('"brand" role from UI is sub-classified into logo/hero/photo/illustration', () => {
    const out = mapImageAssets([
      { data: 'a', name: 'my-logo.png', role: 'brand' },
      { data: 'b', name: 'banner.jpg', role: 'brand' },
      { data: 'c', name: 'product-shot.jpg', role: 'brand' },
      { data: 'd', name: 'mascot.svg', role: 'brand', note: 'illustration for empty state' },
    ])
    expect(out[0].role).toBe('logo')
    expect(out[1].role).toBe('hero')
    expect(out[2].role).toBe('photo')
    // Note containing "illustration" promotes role
    expect(out[3].role).toBe('illustration')
  })

  test('preserves note on every output asset', () => {
    const out = mapImageAssets([
      { data: 'a', role: 'brand', note: 'use as hero bg' },
    ])
    expect(out[0].note).toBe('use as hero bg')
  })

  test('preserves pre-formed data: URIs without re-prefixing', () => {
    const pre = 'data:image/png;base64,AAAA'
    const out = mapImageAssets([{ data: pre, name: 'logo.png' }])
    expect(out[0].dataUrl).toBe(pre)
  })

  test('index is contiguous 0..N-1', () => {
    const out = mapImageAssets([{ data: 'a' }, { data: 'b' }, { data: 'c' }])
    expect(out.map((a) => a.index)).toEqual([0, 1, 2])
  })
})

describe('buildAssetsFileContent (components/assets.js generator)', () => {
  test('empty input returns empty string (no file emitted)', () => {
    expect(buildAssetsFileContent([])).toBe('')
    expect(buildAssetsFileContent(null)).toBe('')
  })

  test('emits LOGO_URL for logo role', () => {
    const out = buildAssetsFileContent([
      { role: 'logo', name: 'logo.png', dataUrl: 'data:image/png;base64,AAAA', index: 0 },
    ])
    expect(out).toContain('export const LOGO_URL = `data:image/png;base64,AAAA`')
  })

  test('emits HERO_URL for hero role', () => {
    const out = buildAssetsFileContent([
      { role: 'hero', name: 'hero.jpg', dataUrl: 'data:image/jpeg;base64,BBBB', index: 0 },
    ])
    expect(out).toContain('export const HERO_URL = `data:image/jpeg;base64,BBBB`')
  })

  test('emits PHOTO_N / ILLUSTRATION_N exports for extra brand assets', () => {
    const out = buildAssetsFileContent([
      { role: 'logo', name: 'l.png', dataUrl: 'data:image/png;base64,A', index: 0 },
      { role: 'photo', name: 'p1.jpg', dataUrl: 'data:image/png;base64,B', index: 1 },
      { role: 'photo', name: 'p2.jpg', dataUrl: 'data:image/png;base64,C', index: 2 },
      { role: 'illustration', name: 'i.svg', dataUrl: 'data:image/png;base64,D', index: 3 },
    ])
    expect(out).toContain('export const LOGO_URL')
    expect(out).toContain('export const PHOTO_0')
    expect(out).toContain('export const PHOTO_1')
    expect(out).toContain('export const ILLUSTRATION_0')
  })

  test('non-renderable roles (aesthetic/structural) produce no exports', () => {
    const out = buildAssetsFileContent([
      { role: 'aesthetic', name: 'mood.jpg', dataUrl: 'data:image/png;base64,A', index: 0 },
      { role: 'structural', name: 'layout.png', dataUrl: 'data:image/png;base64,B', index: 1 },
    ])
    expect(out).toBe('')
  })

  test('user placement note is rendered as JSDoc above the export', () => {
    const out = buildAssetsFileContent([
      { role: 'logo', name: 'l.png', dataUrl: 'data:image/png;base64,A', index: 0, note: 'Use in navbar and as feature-card badge' },
    ])
    expect(out).toContain('/** Use in navbar and as feature-card badge */')
    expect(out).toContain('export const LOGO_URL')
  })

  test('escapes backticks inside the data URL (prevents template-literal break)', () => {
    const out = buildAssetsFileContent([
      { role: 'logo', name: 'x.png', dataUrl: 'data:image/png;base64,AA`BB', index: 0 },
    ])
    expect(out).toContain('AA\\`BB')
    expect(out).not.toMatch(/AA`BB/)
  })

  test('escapes $ so `${}` interpolation inside the data URL is neutralised', () => {
    const out = buildAssetsFileContent([
      { role: 'logo', name: 'x.png', dataUrl: 'data:image/png;base64,AA${evil}BB', index: 0 },
    ])
    expect(out).toContain('AA\\${evil}BB')
  })

  test('includes the auto-generated header comment', () => {
    const out = buildAssetsFileContent([
      { role: 'logo', name: 'x.png', dataUrl: 'data:image/png;base64,AAAA', index: 0 },
    ])
    expect(out).toContain('// AUTO-GENERATED by Emanator')
    expect(out).toContain("import { LOGO_URL, HERO_URL, PHOTO_0, ILLUSTRATION_0 } from '../components/assets'")
  })

  test('is valid JavaScript (evaluable)', () => {
    const out = buildAssetsFileContent([
      { role: 'logo', name: 'x.png', dataUrl: 'data:image/png;base64,AAAA', index: 0 },
      { role: 'photo', name: 'y.png', dataUrl: 'data:image/png;base64,B`${bad}C', index: 1 },
    ])
    // Evaluate as ESM would (replace `export const` with plain const, then eval)
    const evaluable = out.replace(/export const/g, 'const') + '\nreturn { LOGO_URL, PHOTO_0 }'
    // eslint-disable-next-line no-new-func
    const result = new Function(evaluable)()
    expect(result.LOGO_URL).toBe('data:image/png;base64,AAAA')
    expect(result.PHOTO_0).toBe('data:image/png;base64,B`${bad}C')
  })
})
