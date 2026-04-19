import { buildManifest } from '../../lib/ai/build-observatory.js'

describe('buildManifest — assets summary', () => {
  test('empty input returns null-safe defaults', () => {
    const m = buildManifest({})
    expect(m.assets.emitted).toBe(false)
    expect(m.theme.emitted).toBe(false)
    expect(m.blueprint).toBe(null)
    expect(m.attachments.total).toBe(0)
    expect(m.timings).toEqual([])
  })

  test('summarises brand exports with size + note', () => {
    const m = buildManifest({
      imageAssets: [
        { role: 'logo', name: 'brand.png', dataUrl: 'data:image/png;base64,' + 'A'.repeat(400), note: 'navbar mark' },
        { role: 'photo', name: 'shot1.jpg', dataUrl: 'data:image/jpeg;base64,' + 'B'.repeat(2000), note: '' },
        { role: 'aesthetic', name: 'mood.jpg', dataUrl: 'data:image/jpeg;base64,AAAA', note: 'match this palette' },
      ],
    })
    expect(m.assets.emitted).toBe(true)
    expect(m.assets.exports).toHaveLength(2) // aesthetic is NOT rendered
    expect(m.assets.exports[0].name).toBe('LOGO_URL')
    expect(m.assets.exports[0].note).toBe('navbar mark')
    expect(m.assets.exports[0].sizeBytes).toBeGreaterThan(200)
    expect(m.assets.exports[1].name).toBe('PHOTO_0')
    expect(m.assets.missing).toContain('HERO_URL')
    expect(m.assets.missing).not.toContain('LOGO_URL')
  })

  test('attachments count by role (brand/aesthetic/structural/untagged)', () => {
    const m = buildManifest({
      rawAttachments: [
        { role: 'brand' }, { role: 'brand' },
        { role: 'aesthetic' },
        { role: 'structural' }, { role: 'structural' }, { role: 'structural' },
        { role: null },
      ],
    })
    expect(m.attachments.total).toBe(7)
    expect(m.attachments.brand).toBe(2)
    expect(m.attachments.aesthetic).toBe(1)
    expect(m.attachments.structural).toBe(3)
    expect(m.attachments.untagged).toBe(1)
  })
})

describe('buildManifest — integrity checks', () => {
  const navbarWithLogo = { path: 'components/Navbar.jsx', content: "import { LOGO_URL } from './assets'\nexport default () => <nav><img src={LOGO_URL} /></nav>" }
  const navbarNoLogo = { path: 'components/Navbar.jsx', content: 'export default () => <nav><span>Brand</span></nav>' }
  const routerClean = { path: 'app/page.jsx', content: 'export default () => <div>{renderRoute()}</div>' }
  const routerWithNavbar = { path: 'app/page.jsx', content: '<div><Navbar /></div>' }
  const landingWithHero = { path: 'pages/Landing.jsx', content: 'import { HERO_URL } from "../components/assets"\n<img src={HERO_URL} />' }
  const landingNoHero = { path: 'pages/Landing.jsx', content: '<main><section>hi</section></main>' }
  const themeEmitted = { path: 'components/theme.js', content: 'export const DESIGN_TOKENS = {}' }
  const assetsFull = { path: 'components/assets.js', content: 'export const LOGO_URL = "data:image/png;base64,AAAA"' }

  test('all integrity passes when pipeline produced correct files', () => {
    const m = buildManifest({
      imageAssets: [{ role: 'logo', name: 'l.png', dataUrl: 'data:image/png;base64,AA', note: '' }],
      projectFiles: [themeEmitted, assetsFull, navbarWithLogo, routerClean],
    })
    expect(m.integrity.every((c) => c.pass)).toBe(true)
  })

  test('fails when theme.js missing', () => {
    const m = buildManifest({ projectFiles: [] })
    const themeCheck = m.integrity.find((c) => c.name.includes('theme.js'))
    expect(themeCheck.pass).toBe(false)
  })

  test('fails when LOGO_URL exported but Navbar does not use it', () => {
    const m = buildManifest({
      imageAssets: [{ role: 'logo', name: 'l.png', dataUrl: 'data:image/png;base64,AA', note: '' }],
      projectFiles: [themeEmitted, assetsFull, navbarNoLogo, routerClean],
    })
    const check = m.integrity.find((c) => c.name.includes('Navbar renders'))
    expect(check.pass).toBe(false)
  })

  test('fails when router renders <Navbar> (duplicate landmark)', () => {
    const m = buildManifest({
      projectFiles: [themeEmitted, routerWithNavbar],
    })
    const check = m.integrity.find((c) => c.name.includes('Router does NOT render'))
    expect(check.pass).toBe(false)
  })

  test('hero check passes when landing renders HERO_URL or PHOTO_0', () => {
    const m = buildManifest({
      imageAssets: [{ role: 'hero', name: 'h.jpg', dataUrl: 'data:image/jpeg;base64,AA', note: '' }],
      projectFiles: [themeEmitted, landingWithHero],
    })
    const check = m.integrity.find((c) => c.name.includes('Landing renders hero'))
    expect(check.pass).toBe(true)
  })

  test('hero check fails when landing is placeholder', () => {
    const m = buildManifest({
      imageAssets: [{ role: 'hero', name: 'h.jpg', dataUrl: 'data:image/jpeg;base64,AA', note: '' }],
      projectFiles: [themeEmitted, landingNoHero],
    })
    const check = m.integrity.find((c) => c.name.includes('Landing renders hero'))
    expect(check.pass).toBe(false)
  })
})

describe('buildManifest — warnings (actionable for the user)', () => {
  test('warns when user uploaded images but none tagged Brand', () => {
    const m = buildManifest({
      rawAttachments: [{ role: 'aesthetic' }, { role: 'structural' }],
      imageAssets: [],
    })
    expect(m.warnings.some((w) => w.includes('none were tagged as Brand'))).toBe(true)
  })

  test('warns when LOGO_URL present but Navbar missing the reference', () => {
    const m = buildManifest({
      imageAssets: [{ role: 'logo', name: 'l.png', dataUrl: 'data:image/png;base64,AA', note: '' }],
      projectFiles: [
        { path: 'components/Navbar.jsx', content: 'nothing' },
      ],
    })
    expect(m.warnings.some((w) => w.includes('Navbar does not reference'))).toBe(true)
  })

  test('warns when hero assets exist but Landing shows placeholder', () => {
    const m = buildManifest({
      imageAssets: [{ role: 'photo', name: 'p.jpg', dataUrl: 'data:image/jpeg;base64,AA', note: '' }],
      projectFiles: [
        { path: 'pages/Landing.jsx', content: '<main><section>hi</section></main>' },
      ],
    })
    expect(m.warnings.some((w) => w.includes('themed placeholder'))).toBe(true)
  })

  test('no warnings when everything is wired correctly', () => {
    const m = buildManifest({
      imageAssets: [{ role: 'logo', name: 'l.png', dataUrl: 'data:image/png;base64,AA', note: '' }],
      rawAttachments: [{ role: 'brand' }],
      projectFiles: [
        { path: 'components/theme.js', content: 'x' },
        { path: 'components/assets.js', content: 'export const LOGO_URL = "x"' },
        { path: 'components/Navbar.jsx', content: 'import { LOGO_URL } from "./assets"\n<img src={LOGO_URL} />' },
      ],
    })
    expect(m.warnings).toEqual([])
  })
})

describe('buildManifest — theme summary', () => {
  test('includes key token fields', () => {
    const m = buildManifest({
      designTokens: {
        mode: 'dark', vibe: 'editorial-dark',
        primary: '#ff5a4e', bg: '#0a0a0a', ink: '#fff', accent: '#ffcc00',
        radius: '0.5rem', fontDisplay: '"GT Sectra", serif', fontBody: '"Inter", sans-serif',
        avoid: ['no glass blur'],
      },
    })
    expect(m.theme.emitted).toBe(true)
    expect(m.theme.tokens.vibe).toBe('editorial-dark')
    expect(m.theme.tokens.primary).toBe('#ff5a4e')
    expect(m.theme.tokens.avoid).toEqual(['no glass blur'])
  })
})

describe('buildManifest — timings', () => {
  test('preserves timing array as-is', () => {
    const timings = [
      { stage: 'art_direction', ms: 3100 },
      { stage: 'design_tokens', ms: 4200 },
      { stage: 'total', ms: 72000 },
    ]
    const m = buildManifest({ timings })
    expect(m.timings).toEqual(timings)
  })
})
