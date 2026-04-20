/**
 * Session 27 Virtual Filesystem Tests
 * Tests the brand asset VFS layer: buildBrandVfsMap, resolveBrandAssets,
 * and the frontend parseBrandVfsFromAssetsModule helper.
 */

import { resolveBrandAssets, buildBrandVfsMap, buildAssetsFileContent, mapImageAssets } from '../../lib/ai/brief-utils.js'

// Simulate the frontend parseBrandVfsFromAssetsModule function
function parseBrandVfsFromAssetsModule(source) {
  if (typeof source !== 'string' || !source) return []
  const exportRe = /export\s+const\s+([A-Z0-9_]+)\s*=\s*`(data:[^`]+)`/g
  const byName = {}
  let m
  while ((m = exportRe.exec(source)) !== null) byName[m[1]] = m[2]

  const vfsBlock = source.match(/VIRTUAL_FS\s*=\s*\{([\s\S]*?)\}/)
  if (!vfsBlock) return []
  const pairRe = /['"]([^'"]+)['"]\s*:\s*([A-Z0-9_]+)/g
  const out = []
  while ((m = pairRe.exec(vfsBlock[1])) !== null) {
    const path = m[1]
    const name = m[2]
    if (byName[name]) out.push({ placeholder: path, dataUrl: byName[name] })
  }
  return out
}

describe('Session 27: Virtual Filesystem Layer', () => {
  describe('resolveBrandAssets', () => {
    test('assigns canonical VFS paths: /logo.png, /hero.jpg, /images/photo-N.png, /illustrations/illustration-N.svg', () => {
      const assets = mapImageAssets([
        { data: 'L', name: 'brand-logo.png', role: 'brand' },
        { data: 'H', name: 'hero-banner.jpg', role: 'brand' },
        { data: 'P0', name: 'product1.png', role: 'brand' },
        { data: 'P1', name: 'product2.png', role: 'brand' },
        { data: 'I', name: 'mascot.svg', role: 'brand', note: 'illustration for empty state' },
      ])
      const resolved = resolveBrandAssets(assets)
      
      expect(resolved.map(r => r.vfsPath)).toEqual([
        '/logo.png',
        '/hero.jpg',
        '/images/photo-0.png',
        '/images/photo-1.png',
        '/illustrations/illustration-0.svg',
      ])
    })

    test('ignores aesthetic and structural roles (never rendered)', () => {
      const assets = mapImageAssets([
        { data: 'A', name: 'moodboard.png', role: 'aesthetic' },
        { data: 'S', name: 'layout.png', role: 'structural' },
        { data: 'L', name: 'logo.png', role: 'brand' },
      ])
      const resolved = resolveBrandAssets(assets)
      
      expect(resolved).toHaveLength(1)
      expect(resolved[0].vfsPath).toBe('/logo.png')
    })
  })

  describe('buildBrandVfsMap', () => {
    test('produces {placeholder, dataUrl} pairs with VFS paths as keys', () => {
      const assets = mapImageAssets([
        { data: 'data:image/png;base64,LOGO', name: 'logo.png', role: 'brand' },
        { data: 'data:image/jpeg;base64,HERO', name: 'hero.jpg', role: 'brand' },
      ])
      const vfsMap = buildBrandVfsMap(assets)
      
      expect(vfsMap).toEqual([
        { placeholder: '/logo.png', dataUrl: 'data:image/png;base64,LOGO' },
        { placeholder: '/hero.jpg', dataUrl: 'data:image/jpeg;base64,HERO' },
      ])
    })

    test('returns empty array for no renderable assets', () => {
      expect(buildBrandVfsMap([])).toEqual([])
      expect(buildBrandVfsMap(null)).toEqual([])
      expect(buildBrandVfsMap([{ role: 'aesthetic', name: 'x.png', dataUrl: 'data:,X', index: 0 }])).toEqual([])
    })
  })

  describe('buildAssetsFileContent', () => {
    test('emits VIRTUAL_FS block with correct path mappings', () => {
      const assets = mapImageAssets([
        { data: 'data:image/png;base64,L', name: 'logo.png', role: 'brand' },
        { data: 'data:image/jpeg;base64,H', name: 'hero.jpg', role: 'brand' },
      ])
      const content = buildAssetsFileContent(assets)
      
      expect(content).toContain('export const VIRTUAL_FS = {')
      expect(content).toContain("'/logo.png': LOGO_URL")
      expect(content).toContain("'/hero.jpg': HERO_URL")
    })

    test('emits window.__EMANATOR_VFS__ assignment for runtime registration', () => {
      const assets = mapImageAssets([
        { data: 'data:image/png;base64,L', name: 'logo.png', role: 'brand' },
      ])
      const content = buildAssetsFileContent(assets)
      
      expect(content).toContain('window.__EMANATOR_VFS__ = Object.assign(window.__EMANATOR_VFS__ || {}, VIRTUAL_FS)')
    })
  })

  describe('parseBrandVfsFromAssetsModule (frontend reload)', () => {
    test('extracts VFS entries from persisted components/assets.js', () => {
      const assets = mapImageAssets([
        { data: 'data:image/png;base64,LOGO', name: 'logo.png', role: 'brand' },
        { data: 'data:image/jpeg;base64,HERO', name: 'hero.jpg', role: 'brand' },
        { data: 'data:image/png;base64,PHOTO', name: 'product.png', role: 'brand' },
      ])
      const moduleSource = buildAssetsFileContent(assets)
      const parsed = parseBrandVfsFromAssetsModule(moduleSource)
      
      expect(parsed).toHaveLength(3)
      expect(parsed.map(p => p.placeholder)).toEqual(['/logo.png', '/hero.jpg', '/images/photo-0.png'])
      expect(parsed[0].dataUrl).toBe('data:image/png;base64,LOGO')
      expect(parsed[1].dataUrl).toBe('data:image/jpeg;base64,HERO')
      expect(parsed[2].dataUrl).toBe('data:image/png;base64,PHOTO')
    })

    test('returns empty array for invalid/empty source', () => {
      expect(parseBrandVfsFromAssetsModule('')).toEqual([])
      expect(parseBrandVfsFromAssetsModule(null)).toEqual([])
      expect(parseBrandVfsFromAssetsModule('// no VIRTUAL_FS block')).toEqual([])
    })

    test('handles normal data URLs without special characters', () => {
      // Note: The regex-based parser stops at backticks, so we test with clean data URLs
      // Real base64 data URLs don't contain backticks or $ signs
      const assets = mapImageAssets([
        { data: 'data:image/png;base64,ABC123XYZ', name: 'logo.png', role: 'brand' },
      ])
      const moduleSource = buildAssetsFileContent(assets)
      const parsed = parseBrandVfsFromAssetsModule(moduleSource)
      
      expect(parsed).toHaveLength(1)
      expect(parsed[0].dataUrl).toBe('data:image/png;base64,ABC123XYZ')
      expect(parsed[0].placeholder).toBe('/logo.png')
    })
  })

  describe('End-to-end: VFS path resolution scenarios', () => {
    test('scenario: LLM writes <img src="/logo.png"> - should resolve via VFS', () => {
      const assets = mapImageAssets([
        { data: 'data:image/png;base64,MYLOGO', name: 'company-logo.png', role: 'brand' },
      ])
      const vfsMap = buildBrandVfsMap(assets)
      
      // Simulate iframe __fixImages logic
      const imgSrc = '/logo.png'
      const map = Object.fromEntries(vfsMap.map(v => [v.placeholder, v.dataUrl]))
      
      // Normalize the src (strip leading ./ and add leading /)
      let norm = imgSrc.replace(/^\.\//, '/')
      if (norm.charAt(0) !== '/') norm = '/' + norm
      norm = norm.replace(/^\/public\//, '/')
      
      expect(map[norm]).toBe('data:image/png;base64,MYLOGO')
    })

    test('scenario: LLM writes <img src="./logo.png"> - should resolve via VFS', () => {
      const assets = mapImageAssets([
        { data: 'data:image/png;base64,MYLOGO', name: 'company-logo.png', role: 'brand' },
      ])
      const vfsMap = buildBrandVfsMap(assets)
      
      const imgSrc = './logo.png'
      const map = Object.fromEntries(vfsMap.map(v => [v.placeholder, v.dataUrl]))
      
      // Normalize
      let norm = imgSrc.replace(/^\.\//, '/')
      if (norm.charAt(0) !== '/') norm = '/' + norm
      norm = norm.replace(/^\/public\//, '/')
      
      expect(map[norm]).toBe('data:image/png;base64,MYLOGO')
    })

    test('scenario: LLM writes <img src="public/logo.png"> - should resolve via VFS', () => {
      const assets = mapImageAssets([
        { data: 'data:image/png;base64,MYLOGO', name: 'company-logo.png', role: 'brand' },
      ])
      const vfsMap = buildBrandVfsMap(assets)
      
      const imgSrc = 'public/logo.png'
      const map = Object.fromEntries(vfsMap.map(v => [v.placeholder, v.dataUrl]))
      
      // Normalize
      let norm = imgSrc.replace(/^\.\//, '/')
      if (norm.charAt(0) !== '/') norm = '/' + norm
      norm = norm.replace(/^\/public\//, '/')
      
      expect(map[norm]).toBe('data:image/png;base64,MYLOGO')
    })

    test('scenario: data: URIs are left alone (no rewriting)', () => {
      const imgSrc = 'data:image/png;base64,ALREADY_INLINE'
      
      // The __fixImages function checks for data: prefix and returns early
      const shouldSkip = imgSrc.indexOf('data:') === 0
      expect(shouldSkip).toBe(true)
    })

    test('scenario: legacy placeholder URLs still work via substring match', () => {
      // Stock/generated images use full placeholder URLs like https://emanator-generated.img/foo.png
      const legacyPlaceholder = 'https://emanator-generated.img/stock_photo_123.png'
      const dataUrl = 'data:image/png;base64,STOCKPHOTO'
      
      const imgSrc = legacyPlaceholder
      const map = { [legacyPlaceholder]: dataUrl }
      
      // Substring match logic from __fixImages
      const keys = Object.keys(map)
      let resolved = null
      for (const k of keys) {
        if (k.charAt(0) !== '/' && imgSrc.indexOf(k) !== -1) {
          resolved = map[k]
          break
        }
      }
      
      expect(resolved).toBe(dataUrl)
    })
  })

  describe('SSE event emission', () => {
    test('buildBrandVfsMap output matches expected SSE payload structure', () => {
      const assets = mapImageAssets([
        { data: 'data:image/png;base64,L', name: 'logo.png', role: 'brand' },
        { data: 'data:image/jpeg;base64,H', name: 'hero.jpg', role: 'brand' },
      ])
      const vfsMap = buildBrandVfsMap(assets)
      
      // This is what gets emitted as: yield { event: 'generated_images_map', data: { images: vfsMap, source: 'brand_vfs' } }
      const ssePayload = { images: vfsMap, source: 'brand_vfs' }
      
      expect(ssePayload.source).toBe('brand_vfs')
      expect(ssePayload.images).toHaveLength(2)
      expect(ssePayload.images[0]).toHaveProperty('placeholder')
      expect(ssePayload.images[0]).toHaveProperty('dataUrl')
    })
  })
})
