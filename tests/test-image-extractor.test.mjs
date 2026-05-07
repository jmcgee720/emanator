// ──────────────────────────────────────────────────────────────────────
// Unit tests for /app/lib/supabase/image-extractor.js
//
// We mirror the regex + dedup logic locally (the live extractor depends
// on Supabase). What we're verifying:
//   1. The data-URI regex matches every format the AI emits (png/jpg/gif/webp/svg+xml)
//   2. Tiny URIs (< 1KB) stay inline
//   3. Big URIs are detected and counted
//   4. Identical URIs produce the same hash → dedup works
//   5. The placeholder URL format matches PreviewTab.jsx's substitution shape
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const DATA_URI_RE = /data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)/g
const MIN_EXTRACT_BYTES = 1024

function normalizeExt(fmt) {
  if (fmt === 'jpeg') return 'jpg'
  if (fmt === 'svg+xml') return 'svg'
  return fmt
}

function findExtractable(content) {
  const matches = [...String(content || '').matchAll(DATA_URI_RE)]
  const out = []
  for (const m of matches) {
    const base64 = m[2]
    if (base64.length * 0.75 < MIN_EXTRACT_BYTES) continue
    const hash = createHash('sha1').update(base64).digest('hex').slice(0, 16)
    const ext = normalizeExt(m[1])
    out.push({
      hash,
      ext,
      placeholder: `https://emanator-generated.img/__gen_img_${hash}.${ext}`,
      assetPath: `_assets/__gen_img_${hash}.${ext}`,
    })
  }
  return out
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// Build a base64 payload of approximately N bytes binary.
function fakePng(approxBytes, seed = 'a') {
  // 4/3 ratio: N base64 chars ≈ 0.75N raw bytes. Make it bigger than the
  // threshold by enough to survive the 0.75 multiplier check.
  const charCount = Math.ceil(approxBytes / 0.75)
  return seed.repeat(charCount).slice(0, charCount)
}

test('regex matches png/jpg/jpeg/webp/gif/svg+xml', () => {
  const big = fakePng(2048)
  const sources = [
    `data:image/png;base64,${big}`,
    `data:image/jpg;base64,${big}`,
    `data:image/jpeg;base64,${big}`,
    `data:image/webp;base64,${big}`,
    `data:image/gif;base64,${big}`,
    `data:image/svg+xml;base64,${big}`,
  ].join('\n\n')
  const found = findExtractable(sources)
  assert.equal(found.length, 6, 'all 6 formats matched')
  assert.deepEqual(
    found.map(f => f.ext).sort(),
    ['gif', 'jpg', 'jpg', 'png', 'svg', 'webp'],
  )
})

test('tiny data URIs (< 1KB) are NOT extracted', () => {
  // A 1x1 GIF is ~70 chars. Don't waste a Storage round-trip on it.
  const tiny = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  const found = findExtractable(`<img src="${tiny}" />`)
  assert.equal(found.length, 0, 'tiny URIs left inline')
})

test('large data URI is detected and gets a stable hash + placeholder', () => {
  const payload = fakePng(50 * 1024) // 50KB binary-ish
  const src = `<img src="data:image/png;base64,${payload}" alt="hero" />`
  const found = findExtractable(src)
  assert.equal(found.length, 1)
  assert.match(found[0].placeholder, /^https:\/\/emanator-generated\.img\/__gen_img_[a-f0-9]{16}\.png$/)
  assert.equal(found[0].assetPath, `_assets/__gen_img_${found[0].hash}.png`)
})

test('same payload twice produces identical hash (dedup)', () => {
  const payload = fakePng(50 * 1024, 'x')
  const src = `
    <img src="data:image/png;base64,${payload}" />
    <img src="data:image/png;base64,${payload}" />
  `
  const found = findExtractable(src)
  assert.equal(found.length, 2)
  assert.equal(found[0].hash, found[1].hash, 'identical payloads → identical hash')
})

test('different payloads produce different hashes', () => {
  const a = fakePng(50 * 1024, 'a')
  const b = fakePng(50 * 1024, 'b')
  const src = `
    <img src="data:image/png;base64,${a}" />
    <img src="data:image/png;base64,${b}" />
  `
  const found = findExtractable(src)
  assert.equal(found.length, 2)
  assert.notEqual(found[0].hash, found[1].hash)
})

test('placeholder format matches PreviewTab.jsx substitution shape', () => {
  // PreviewTab.jsx ~line 1413 builds:
  //   `https://emanator-generated.img/${filename}` where filename =
  //   `_assets/__gen_img_NNN.ext`.split('/').pop() === '__gen_img_NNN.ext'
  // So the placeholder URL must be `https://emanator-generated.img/__gen_img_<hash>.<ext>`.
  // Any drift here breaks live preview rendering.
  const payload = fakePng(50 * 1024)
  const found = findExtractable(`data:image/png;base64,${payload}`)[0]
  const filename = found.assetPath.split('/').pop()
  assert.equal(`https://emanator-generated.img/${filename}`, found.placeholder)
})

test('extracted output is dramatically smaller than inlined source', () => {
  // Sanity check matching the real-world failure: 12 inlined PNGs in a JSX
  // file, totaling ~24MB. After extraction the source should be under 1MB.
  const onePng = fakePng(2 * 1024 * 1024) // 2MB binary ≈ 2.6MB base64
  const code = `
    export default function Page() {
      return (
        <div>
          ${Array(12).fill(0).map(() => `<img src="data:image/png;base64,${onePng}" />`).join('\n')}
        </div>
      )
    }
  `
  const before = code.length
  const found = findExtractable(code)
  assert.equal(found.length, 12)
  // Simulate the rewrite: replace each match with its placeholder URL.
  let after = code
  for (const f of found) {
    after = after.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/, f.placeholder)
  }
  assert.ok(before > 30 * 1024 * 1024, 'pre-extraction is >30MB (matches Nexsara repro)')
  assert.ok(after.length < 1024, `post-extraction is <1KB (got ${after.length} bytes)`)
})

test('module exports the documented surface', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role'
  const mod = await import('../lib/supabase/image-extractor.js')
  assert.equal(typeof mod.extractInlineImages, 'function')
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (e) { console.error(`  ✗ ${t.name}\n      ${e.message}`); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
