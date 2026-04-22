import {
  toWebContainerTree,
  ensureScaffolding,
  buildPackageJson,
  flattenTree,
  NEXT_CONFIG_JS,
  TAILWIND_CONFIG_JS,
  POSTCSS_CONFIG_JS,
  GLOBALS_CSS,
  APP_LAYOUT_JSX,
} from '../../lib/webcontainer/file-tree.js'

describe('toWebContainerTree', () => {
  it('returns {} for empty / invalid input', () => {
    expect(toWebContainerTree([])).toEqual({})
    expect(toWebContainerTree(null)).toEqual({})
    expect(toWebContainerTree(undefined)).toEqual({})
  })

  it('converts a single top-level file', () => {
    const tree = toWebContainerTree([{ path: 'README.md', content: '# hi' }])
    expect(tree).toEqual({
      'README.md': { file: { contents: '# hi' } },
    })
  })

  it('nests files into directory nodes', () => {
    const tree = toWebContainerTree([
      { path: 'app/page.jsx', content: 'export default () => null' },
      { path: 'app/layout.jsx', content: 'layout' },
      { path: 'components/Hero.jsx', content: 'hero' },
    ])
    expect(tree.app).toEqual(expect.objectContaining({ directory: expect.any(Object) }))
    expect(tree.app.directory['page.jsx']).toEqual({ file: { contents: 'export default () => null' } })
    expect(tree.app.directory['layout.jsx']).toEqual({ file: { contents: 'layout' } })
    expect(tree.components.directory['Hero.jsx']).toEqual({ file: { contents: 'hero' } })
  })

  it('supports deeply nested paths', () => {
    const tree = toWebContainerTree([
      { path: 'components/primitives/Hero.jsx', content: 'h' },
      { path: 'components/primitives/Pricing.jsx', content: 'p' },
    ])
    const dir = tree.components.directory.primitives.directory
    expect(dir['Hero.jsx']).toEqual({ file: { contents: 'h' } })
    expect(dir['Pricing.jsx']).toEqual({ file: { contents: 'p' } })
  })

  it('strips leading slashes', () => {
    const tree = toWebContainerTree([{ path: '/app/page.jsx', content: 'x' }])
    expect(tree.app.directory['page.jsx']).toEqual({ file: { contents: 'x' } })
  })

  it('skips invalid entries without throwing', () => {
    const tree = toWebContainerTree([
      { path: 'ok.js', content: 'ok' },
      null,
      { path: '', content: 'empty-path' },
      { path: 'no-content' }, // no content field
    ])
    expect(tree['ok.js']).toBeDefined()
    expect(tree['no-content']).toEqual({ file: { contents: '' } })
    expect(Object.keys(tree).length).toBe(2)
  })

  it('coerces non-string content to empty string', () => {
    const tree = toWebContainerTree([{ path: 'weird.js', content: { foo: 'bar' } }])
    expect(tree['weird.js']).toEqual({ file: { contents: '' } })
  })
})

describe('buildPackageJson', () => {
  it('produces valid JSON with Next 14 + React 18 pinned', () => {
    const pkg = JSON.parse(buildPackageJson('MyApp'))
    expect(pkg.name).toBe('myapp')
    expect(pkg.dependencies.next).toBe('14.2.3')
    expect(pkg.dependencies.react).toBe('18.3.1')
    expect(pkg.scripts.dev).toContain('next dev')
    expect(pkg.devDependencies.tailwindcss).toMatch(/^\^3/)
  })

  it('sanitises the name (lowercase, kebab-case, no illegal chars)', () => {
    const pkg = JSON.parse(buildPackageJson('Hello World!! 123'))
    expect(pkg.name).toBe('hello-world-123')
  })

  it('falls back to a default name when empty / invalid', () => {
    const pkg = JSON.parse(buildPackageJson('!!!'))
    expect(pkg.name).toBe('emanator-preview')
    const def = JSON.parse(buildPackageJson())
    expect(def.name).toBe('emanator-preview')
  })

  it('output ends with newline', () => {
    expect(buildPackageJson().endsWith('\n')).toBe(true)
  })
})

describe('ensureScaffolding', () => {
  it('injects all required scaffolding files when tree is empty', () => {
    const out = ensureScaffolding({})
    expect(out['package.json']).toBeDefined()
    expect(out['next.config.js']).toBeDefined()
    expect(out['tailwind.config.js']).toBeDefined()
    expect(out['postcss.config.js']).toBeDefined()
    expect(out.app.directory['globals.css']).toBeDefined()
    expect(out.app.directory['layout.jsx']).toBeDefined()
  })

  it('does NOT overwrite user-provided files', () => {
    const base = toWebContainerTree([
      { path: 'package.json', content: '{"name": "user-pkg"}' },
      { path: 'app/layout.jsx', content: 'user layout' },
    ])
    const out = ensureScaffolding(base)
    expect(out['package.json'].file.contents).toBe('{"name": "user-pkg"}')
    expect(out.app.directory['layout.jsx'].file.contents).toBe('user layout')
    // But still adds missing scaffolding
    expect(out['next.config.js'].file.contents).toBe(NEXT_CONFIG_JS)
    expect(out['tailwind.config.js'].file.contents).toBe(TAILWIND_CONFIG_JS)
  })

  it('merges user content with scaffolding correctly', () => {
    const base = toWebContainerTree([
      { path: 'app/page.jsx', content: 'user page' },
      { path: 'components/Hero.jsx', content: 'hero' },
    ])
    const out = ensureScaffolding(base)
    expect(out.app.directory['page.jsx'].file.contents).toBe('user page')
    expect(out.app.directory['layout.jsx'].file.contents).toBe(APP_LAYOUT_JSX)
    expect(out.app.directory['globals.css'].file.contents).toBe(GLOBALS_CSS)
    expect(out.components.directory['Hero.jsx'].file.contents).toBe('hero')
  })

  it('respects projectName for the package.json name', () => {
    const out = ensureScaffolding({}, { projectName: 'Test Project' })
    const pkg = JSON.parse(out['package.json'].file.contents)
    expect(pkg.name).toBe('test-project')
  })

  it('scaffolding files have expected content', () => {
    expect(NEXT_CONFIG_JS).toContain("module.exports")
    expect(TAILWIND_CONFIG_JS).toContain('./app/**/*')
    expect(POSTCSS_CONFIG_JS).toContain('tailwindcss')
    expect(GLOBALS_CSS).toContain('@tailwind base')
    expect(APP_LAYOUT_JSX).toContain('<html')
  })
})

describe('flattenTree', () => {
  it('returns [] for null / empty', () => {
    expect(flattenTree(null)).toEqual([])
    expect(flattenTree({})).toEqual([])
  })

  it('round-trips toWebContainerTree → flattenTree with identical paths', () => {
    const files = [
      { path: 'app/page.jsx', content: 'page' },
      { path: 'app/layout.jsx', content: 'layout' },
      { path: 'components/Hero.jsx', content: 'hero' },
      { path: 'README.md', content: '# hi' },
    ]
    const flat = flattenTree(toWebContainerTree(files))
    const paths = flat.map((f) => f.path).sort()
    expect(paths).toEqual(['README.md', 'app/layout.jsx', 'app/page.jsx', 'components/Hero.jsx'])
    for (const f of files) {
      const match = flat.find((x) => x.path === f.path)
      expect(match?.content).toBe(f.content)
    }
  })

  it('flattens after ensureScaffolding — every leaf reachable', () => {
    const tree = ensureScaffolding(toWebContainerTree([{ path: 'components/Hero.jsx', content: 'h' }]))
    const paths = flattenTree(tree).map((f) => f.path).sort()
    expect(paths).toEqual(expect.arrayContaining([
      'package.json', 'next.config.js', 'tailwind.config.js', 'postcss.config.js',
      'app/globals.css', 'app/layout.jsx', 'components/Hero.jsx',
    ]))
  })
})
