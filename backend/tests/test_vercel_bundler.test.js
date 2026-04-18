/**
 * Tests for the Vercel-ready export bundler.
 * Ensures package.json is valid, React imports get injected, and Supabase
 * is conditionally wired.
 */

import { buildVercelReadyFileMap } from '../../lib/export/vercel-bundler.js'

describe('buildVercelReadyFileMap', () => {
  const project = { id: 'p_1', name: 'NexApp', settings: {} }

  test('produces all scaffold files', () => {
    const map = buildVercelReadyFileMap(project, [])
    expect(map['package.json']).toBeDefined()
    expect(map['vite.config.js']).toBeDefined()
    expect(map['index.html']).toBeDefined()
    expect(map['src/main.jsx']).toBeDefined()
    expect(map['src/index.css']).toBeDefined()
    expect(map['tailwind.config.js']).toBeDefined()
    expect(map['postcss.config.js']).toBeDefined()
    expect(map['README.md']).toBeDefined()
    expect(map['.gitignore']).toBeDefined()
  })

  test('package.json is valid JSON with react/vite deps', () => {
    const map = buildVercelReadyFileMap(project, [])
    const pkg = JSON.parse(map['package.json'])
    expect(pkg.dependencies.react).toBeDefined()
    expect(pkg.dependencies['react-dom']).toBeDefined()
    expect(pkg.devDependencies.vite).toBeDefined()
    expect(pkg.devDependencies.tailwindcss).toBeDefined()
    expect(pkg.scripts.dev).toBe('vite')
    expect(pkg.scripts.build).toBe('vite build')
  })

  test('sanitizes project name in package.json', () => {
    const map = buildVercelReadyFileMap({ ...project, name: 'Nex App!! 2026' }, [])
    const pkg = JSON.parse(map['package.json'])
    expect(pkg.name).toBe('nex-app-2026')
  })

  test('injects React imports into generated JSX files', () => {
    const files = [
      { path: 'pages/Signup.jsx', content: 'export default function Signup() { const [x, setX] = useState(""); return <div/> }' },
    ]
    const map = buildVercelReadyFileMap(project, files)
    const out = map['src/pages/Signup.jsx']
    expect(out).toMatch(/^import React, \{[^}]*useState[^}]*\} from 'react'/)
    expect(out).toContain('export default function Signup')
  })

  test('does NOT double-inject when a file already imports React', () => {
    const files = [
      { path: 'pages/Home.jsx', content: "import React from 'react'\nexport default function Home() { return <div/> }" },
    ]
    const map = buildVercelReadyFileMap(project, files)
    const out = map['src/pages/Home.jsx']
    const matches = out.match(/import React/g) || []
    expect(matches.length).toBe(1)
  })

  test('does not inject React into non-JS files', () => {
    const files = [
      { path: 'assets/logo.svg', content: '<svg/>' },
    ]
    const map = buildVercelReadyFileMap(project, files)
    expect(map['src/assets/logo.svg']).toBe('<svg/>')
  })

  test('includes @supabase/supabase-js when project has supabase config', () => {
    const p = { ...project, settings: { supabase: { url: 'https://x.supabase.co', anonKey: 'anon-123' } } }
    const map = buildVercelReadyFileMap(p, [])
    const pkg = JSON.parse(map['package.json'])
    expect(pkg.dependencies['@supabase/supabase-js']).toBeDefined()
    expect(map['.env.local.example']).toContain('VITE_SUPABASE_URL=https://x.supabase.co')
    expect(map['.env.local.example']).toContain('VITE_SUPABASE_ANON_KEY=anon-123')
    expect(map['README.md']).toContain('Supabase')
  })

  test('omits supabase deps when no config', () => {
    const map = buildVercelReadyFileMap(project, [])
    const pkg = JSON.parse(map['package.json'])
    expect(pkg.dependencies['@supabase/supabase-js']).toBeUndefined()
    expect(map['.env.local.example']).toBeUndefined()
  })

  test('includes react-router-dom when any file imports it', () => {
    const files = [
      { path: 'App.jsx', content: "import { BrowserRouter } from 'react-router-dom'\nexport default function App() { return <BrowserRouter/> }" },
    ]
    const map = buildVercelReadyFileMap(project, files)
    const pkg = JSON.parse(map['package.json'])
    expect(pkg.dependencies['react-router-dom']).toBeDefined()
  })

  test('falls back to placeholder App when none exists', () => {
    const files = [
      { path: 'components/Navbar.jsx', content: 'export default function Navbar() { return <nav/> }' },
    ]
    const map = buildVercelReadyFileMap(project, files)
    expect(map['src/App.jsx']).toMatch(/Export succeeded|export default App/)
  })

  test('preserves App.jsx when present', () => {
    const files = [
      { path: 'App.jsx', content: 'export default function App() { return <div>Real app</div> }' },
    ]
    const map = buildVercelReadyFileMap(project, files)
    expect(map['src/App.jsx']).toContain('Real app')
  })
})
