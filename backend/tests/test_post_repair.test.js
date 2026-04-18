/**
 * Deterministic post-repair safety net tests.
 * Each fixer must be: idempotent, conservative (no-op when unsure),
 * and guaranteed to fix the 3 regressions that prompt rules miss.
 */

import {
  stripRouterLandmarks,
  ensureNavbarLogo,
  ensureHeroImage,
  runPostRepair,
} from '../../lib/ai/post-repair.js'

// ── stripRouterLandmarks ─────────────────────────────────────────────
describe('stripRouterLandmarks', () => {
  test('removes <Navbar /> self-closing tag from router', () => {
    const input = `export default function App() {
  return (
    <AuthProvider>
      <div>
        <Navbar />
        {renderRoute()}
      </div>
    </AuthProvider>
  )
}`
    const { content, changed } = stripRouterLandmarks(input)
    expect(changed).toBe(true)
    expect(content).not.toMatch(/<Navbar\b/)
  })

  test('removes <Footer /> from router too', () => {
    const input = '<main><Footer /></main>'
    const { content, changed } = stripRouterLandmarks(input)
    expect(changed).toBe(true)
    expect(content).not.toMatch(/<Footer\b/)
  })

  test('removes Navbar import when rendered at router level', () => {
    const input = `import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function App() {
  return <div><Navbar /></div>
}`
    const { content } = stripRouterLandmarks(input)
    expect(content).not.toContain("import Navbar")
    expect(content).not.toContain("import Footer")
  })

  test('no-op when router has no Navbar/Footer', () => {
    const input = 'export default function App() { return <div>{renderRoute()}</div> }'
    const { content, changed } = stripRouterLandmarks(input)
    expect(changed).toBe(false)
    expect(content).toBe(input)
  })

  test('idempotent', () => {
    const input = 'export default function App() { return <div><Navbar /></div> }'
    const once = stripRouterLandmarks(input).content
    const twice = stripRouterLandmarks(once).content
    expect(once).toBe(twice)
  })

  test('handles block-form <Navbar>...</Navbar>', () => {
    const input = `  <Navbar onNavigate={navigate}>
    <span>extra</span>
  </Navbar>`
    const { content, changed } = stripRouterLandmarks(input)
    expect(changed).toBe(true)
    expect(content).not.toMatch(/<Navbar\b/)
    expect(content).not.toMatch(/<\/Navbar>/)
  })
})

// ── ensureNavbarLogo ─────────────────────────────────────────────────
describe('ensureNavbarLogo', () => {
  test('replaces recipe gradient-square placeholder with <img src={LOGO_URL}>', () => {
    const input = `export default function Navbar() {
  return (
    <nav>
      <button data-testid="navbar-brand">
        <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500" aria-hidden="true" />
        <span>Nexsara</span>
      </button>
    </nav>
  )
}`
    const { content, changed } = ensureNavbarLogo(input)
    expect(changed).toBe(true)
    expect(content).toContain('src={LOGO_URL}')
    expect(content).not.toMatch(/bg-gradient-to-br from-violet-500 to-indigo-500/)
    expect(content).toContain("import { LOGO_URL }")
  })

  test('replaces plain-text "Nexsara Logo" placeholder with <img>', () => {
    const input = `export default function Navbar() {
  return (
    <nav>
      <button data-testid="navbar-brand">Nexsara Logo</button>
    </nav>
  )
}`
    const { content, changed } = ensureNavbarLogo(input)
    expect(changed).toBe(true)
    expect(content).toContain('src={LOGO_URL}')
    expect(content).not.toContain('Nexsara Logo')
  })

  test('no-op when <img src={LOGO_URL}> already present', () => {
    const input = `import { LOGO_URL } from './assets'
export default function Navbar() {
  return <nav><img src={LOGO_URL} alt="Logo" /></nav>
}`
    const { content, changed } = ensureNavbarLogo(input)
    expect(changed).toBe(false)
    expect(content).toBe(input)
  })

  test('injects import even if no placeholder found but has brand button', () => {
    const input = `export default function Navbar() {
  return (
    <nav>
      <button data-testid="navbar-brand" aria-label="Go to home">
        <span>Brand</span>
      </button>
    </nav>
  )
}`
    const { content, changed } = ensureNavbarLogo(input)
    expect(changed).toBe(true)
    expect(content).toContain('src={LOGO_URL}')
    expect(content).toContain("import { LOGO_URL }")
  })

  test('idempotent', () => {
    const input = `export default function Navbar() {
  return <nav><button data-testid="navbar-brand"><span className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500" aria-hidden="true" /></button></nav>
}`
    const once = ensureNavbarLogo(input).content
    const twice = ensureNavbarLogo(once).content
    expect(once).toBe(twice)
  })

  test('no-op when the file has no recognisable brand anchor at all', () => {
    const input = 'export default function Navbar() { return <nav>nothing</nav> }'
    const { content, changed } = ensureNavbarLogo(input)
    expect(changed).toBe(false)
    expect(content).toBe(input)
  })
})

// ── ensureHeroImage ──────────────────────────────────────────────────
describe('ensureHeroImage', () => {
  test('injects <img src={HERO_URL}> into a hero section', () => {
    const input = `export default function Landing() {
  return (
    <main>
      <section className="hero py-24">
        <h1>Hero title</h1>
      </section>
    </main>
  )
}`
    const { content, changed } = ensureHeroImage(input)
    expect(changed).toBe(true)
    expect(content).toContain('src={HERO_URL}')
    expect(content).toContain("import { HERO_URL }")
  })

  test('falls back to the first <section> when no "hero" class', () => {
    const input = '<main><section><h1>X</h1></section></main>'
    const { content, changed } = ensureHeroImage(input)
    expect(changed).toBe(true)
    expect(content).toContain('src={HERO_URL}')
  })

  test('no-op when hero img already present', () => {
    const input = `import { HERO_URL } from '../components/assets'
<section><img src={HERO_URL} /></section>`
    const { content, changed } = ensureHeroImage(input)
    expect(changed).toBe(false)
    expect(content).toBe(input)
  })

  test('no-op when there is no section/main anchor', () => {
    const input = '<div>just a div</div>'
    const { content, changed } = ensureHeroImage(input)
    expect(changed).toBe(false)
    expect(content).toBe(input)
  })
})

// ── runPostRepair orchestrator ───────────────────────────────────────
describe('runPostRepair', () => {
  test('emits updates only for files actually modified', () => {
    const files = [
      { path: 'app/page.jsx', content: '<div><Navbar /></div>' },
      { path: 'components/Navbar.jsx', content: 'export default function Navbar() { return <nav><button data-testid="navbar-brand"><span className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500" aria-hidden="true" /></button></nav> }' },
      { path: 'components/AuthContext.jsx', content: 'export default function AuthProvider() { return null }' },
      { path: 'pages/Dashboard.jsx', content: 'export default function Dashboard() { return <div>dash</div> }' },
    ]
    const { updates, modifiedPaths } = runPostRepair(files, { imageAssets: [{ role: 'logo' }] })
    expect(modifiedPaths).toContain('app/page.jsx')
    expect(modifiedPaths).toContain('components/Navbar.jsx')
    expect(modifiedPaths).not.toContain('components/AuthContext.jsx')
    expect(modifiedPaths).not.toContain('pages/Dashboard.jsx')
    expect(updates.length).toBe(2)
  })

  test('skips Navbar logo injection when no logo asset was uploaded', () => {
    const files = [
      { path: 'components/Navbar.jsx', content: '<button data-testid="navbar-brand"><span className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500" aria-hidden="true" /></button>' },
    ]
    const { modifiedPaths } = runPostRepair(files, { imageAssets: [] })
    expect(modifiedPaths).toHaveLength(0)
  })

  test('skips hero injection when no hero asset', () => {
    const files = [
      { path: 'pages/Landing.jsx', content: '<main><section><h1>X</h1></section></main>' },
    ]
    const { modifiedPaths } = runPostRepair(files, { imageAssets: [{ role: 'logo' }] })
    expect(modifiedPaths).toHaveLength(0)
  })

  test('applies all three fixes in one pass on a full build', () => {
    const files = [
      { path: 'app/page.jsx', content: '<div><Navbar /><Footer /></div>' },
      { path: 'components/Navbar.jsx', content: '<nav><button data-testid="navbar-brand">Nexsara Logo</button></nav>' },
      { path: 'pages/Landing.jsx', content: '<main><section className="hero"><h1>Hi</h1></section></main>' },
    ]
    const { modifiedPaths } = runPostRepair(files, { imageAssets: [{ role: 'logo' }, { role: 'hero' }] })
    expect(modifiedPaths.sort()).toEqual(['app/page.jsx', 'components/Navbar.jsx', 'pages/Landing.jsx'])
  })

  test('empty or invalid input returns empty', () => {
    expect(runPostRepair(null).updates).toEqual([])
    expect(runPostRepair([]).updates).toEqual([])
    expect(runPostRepair([{}]).updates).toEqual([])
  })
})
