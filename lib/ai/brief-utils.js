// Shared helpers for the new brief pipeline.
// Kept separate so it's easy to add more post-processing without bloating
// brief-builder.js or brief-reviewer.js.

/**
 * Detect and auto-fix common LLM omissions in generated files:
 *  1. Double-escaped newlines (the repair-wave regression)
 *  2. Missing imports for useAuth / useMockAPI that are referenced bare in code
 *
 * Idempotent — safe to run on already-clean files.
 */
export function normalizeFileContent(content) {
  if (typeof content !== 'string' || content.length === 0) return content

  const hasRealNewlines = content.includes('\n')
  const hasLiteralBackslashN = /\\n/.test(content)

  let out = content
  if (!hasRealNewlines && hasLiteralBackslashN) {
    // Double-escaped — unescape in one pass
    out = content
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
  }

  return out
}

/**
 * Auto-insert missing imports for the well-known hooks the LLM sometimes forgets.
 * Only fires for files under `pages/` or `components/` (not AuthContext / MockAPIProvider itself).
 */
const HOOK_IMPORTS = [
  { symbol: 'useAuth', source: 'AuthContext', relPath: '../components/AuthContext' },
  { symbol: 'useMockAPI', source: 'MockAPIProvider', relPath: '../components/MockAPIProvider' },
]

export function autoInjectMissingImports(path, content) {
  if (typeof content !== 'string' || !content) return content
  if (!/^(pages|components)\//.test(path)) return content

  // Don't touch the source files themselves
  if (path.endsWith('AuthContext.jsx') || path.endsWith('MockAPIProvider.jsx')) return content

  let out = content
  const importsToAdd = []

  for (const hook of HOOK_IMPORTS) {
    // Is the symbol referenced anywhere in the file?
    const usageRegex = new RegExp(`\\b${hook.symbol}\\s*\\(`)
    if (!usageRegex.test(out)) continue

    // Is there already an import for it? Accept any relative path.
    const importRegex = new RegExp(`import\\s*{[^}]*\\b${hook.symbol}\\b[^}]*}\\s*from\\s*['"][^'"]*${hook.source}['"]`)
    if (importRegex.test(out)) continue

    // Also accept a default + named import combo e.g. `import X, { useAuth } from '...'`
    const combinedRegex = new RegExp(`import[^;]*\\{[^}]*\\b${hook.symbol}\\b[^}]*\\}[^;]*from\\s*['"][^'"]*${hook.source}['"]`)
    if (combinedRegex.test(out)) continue

    // Adjust relative path based on file depth (pages/x.jsx → ../components, components/x.jsx → ./)
    const relPath = path.startsWith('components/')
      ? `./${hook.source}`
      : `../components/${hook.source}`
    importsToAdd.push(`import { ${hook.symbol} } from '${relPath}'`)
  }

  if (importsToAdd.length === 0) return out

  // Insert after any existing top-level imports; otherwise at the very top.
  const lines = out.split('\n')
  let insertAt = 0
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s+/.test(lines[i])) insertAt = i + 1
    else if (insertAt > 0) break
    else if (lines[i].trim() === '' || lines[i].startsWith('//')) continue
    else break
  }
  lines.splice(insertAt, 0, ...importsToAdd)
  return lines.join('\n')
}

/**
 * Apply normalizeFileContent + autoInjectMissingImports to every file.
 */
export function normalizeFiles(files) {
  if (!Array.isArray(files)) return []
  return files.map((f) =>
    f && typeof f === 'object'
      ? { ...f, content: autoInjectMissingImports(f.path, normalizeFileContent(f.content)) }
      : f
  )
}

/**
 * Map raw image attachments to role-tagged assets the builder can use. When
 * the UI supplies `role` + `note` (new 3-category upload flow), we honour it
 * directly — no filename guessing. Falls back to the legacy filename-match
 * heuristic when `role` is absent (older clients, API callers).
 *
 * Roles:
 *   - 'logo'        → rendered as <img src={LOGO_URL}> in navbar + footer
 *   - 'hero'        → rendered as <img src={HERO_URL}> on the landing hero
 *   - 'photo'       → rendered as <img src={PHOTO_N}> in feature slots
 *   - 'illustration'→ rendered as <img src={ILLUSTRATION_N}> in empty-states
 *   - 'aesthetic'   → NEVER rendered; fed to Vision for tokens + image-in-wave
 *   - 'structural'  → NEVER rendered; fed to Vision for layout blueprint
 *   - 'reference'   → legacy catch-all (treated as aesthetic)
 *
 * @param {Array<{data: string, name?: string, filename?: string, role?: string, note?: string}>} attachments
 * @returns {Array<{role: string, name: string, dataUrl: string, index: number, note: string}>}
 */
export function mapImageAssets(attachments) {
  const imgs = (attachments || []).filter((a) => a && a.data)
  // Category 'brand' from the new UI is a bucket — we still need to split it
  // by filename/position into logo/photo/illustration so recipes can slot
  // each asset correctly. Aesthetic + structural come through unchanged.
  let logoClaimed = false
  let heroClaimed = false
  return imgs.slice(0, 8).map((att, idx) => {
    const filename = (att.name || att.filename || '').toLowerCase()
    const note = (att.note || '').toString()
    const uiRole = att.role || null

    // Honour explicit UI roles first.
    if (uiRole === 'aesthetic' || uiRole === 'structural') {
      return { role: uiRole, name: att.name || `image_${idx}`, dataUrl: ensureDataUrl(att, filename), index: idx, note }
    }

    // 'brand' bucket or legacy input → sub-classify.
    if (uiRole === 'brand' || uiRole === null) {
      let role = 'photo'
      if (/logo|mark|icon|brand/.test(filename) || /\blogo\b|\bmark\b/.test(note)) { role = 'logo'; logoClaimed = true }
      else if (/hero|banner|cover|header/.test(filename) || /\bhero\b|\bbanner\b/.test(note)) { role = 'hero'; heroClaimed = true }
      else if (/illustration|drawing|icon-set/.test(filename) || /\billustration\b/.test(note)) { role = 'illustration' }
      else if (!logoClaimed && imgs.length <= 2 && idx === 0) { role = 'logo'; logoClaimed = true }
      else if (!heroClaimed && role === 'photo' && idx === 1) { role = 'hero'; heroClaimed = true }
      return { role, name: att.name || `image_${idx}`, dataUrl: ensureDataUrl(att, filename), index: idx, note }
    }

    // Pass-through for any other role string.
    return { role: uiRole, name: att.name || `image_${idx}`, dataUrl: ensureDataUrl(att, filename), index: idx, note }
  })
}

function ensureDataUrl(att, filename) {
  if (att.data && att.data.startsWith('data:')) return att.data
  const ext = (filename.split('.').pop() || 'png').toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'svg' ? 'image/svg+xml'
    : 'image/png'
  return `data:${mime};base64,${att.data}`
}

/**
 * Resolve the renderable brand assets into their canonical export names and
 * virtual-filesystem paths. Pure function — shared between `buildAssetsFileContent`
 * (emits the JS module) and `buildBrandVfsMap` (emits the SSE map that lets the
 * preview iframe resolve path-form `src="/logo.png"` attributes at runtime).
 *
 * @param {ReturnType<typeof mapImageAssets>} imageAssets
 * @returns {Array<{exportName: string, vfsPath: string, dataUrl: string, role: string, note: string}>}
 */
export function resolveBrandAssets(imageAssets) {
  if (!Array.isArray(imageAssets) || imageAssets.length === 0) return []
  const renderable = imageAssets.filter((a) => ['logo', 'hero', 'photo', 'illustration'].includes(a.role))
  if (renderable.length === 0) return []

  let photoIdx = 0
  let illuIdx = 0
  let logoSeen = false
  let heroSeen = false

  const out = []
  for (const a of renderable) {
    let exportName
    let vfsPath
    if (a.role === 'logo' && !logoSeen) {
      exportName = 'LOGO_URL'; logoSeen = true
      vfsPath = '/logo.png'
    } else if (a.role === 'hero' && !heroSeen) {
      exportName = 'HERO_URL'; heroSeen = true
      vfsPath = '/hero.jpg'
    } else if (a.role === 'photo' || a.role === 'logo' || a.role === 'hero') {
      const i = photoIdx++
      exportName = `PHOTO_${i}`
      vfsPath = `/images/photo-${i}.png`
    } else if (a.role === 'illustration') {
      const i = illuIdx++
      exportName = `ILLUSTRATION_${i}`
      vfsPath = `/illustrations/illustration-${i}.svg`
    } else continue

    out.push({ exportName, vfsPath, dataUrl: a.dataUrl, role: a.role, note: a.note || '' })
  }
  return out
}

/**
 * Produce the `{ '/logo.png': dataUrl, ... }` map emitted over SSE so the
 * preview iframe can resolve path-form `<img src="/logo.png">` attributes
 * (i.e., code the LLM writes naturally without importing LOGO_URL). The
 * same paths are the ones baked into `components/assets.js` → VIRTUAL_FS.
 *
 * @param {ReturnType<typeof mapImageAssets>} imageAssets
 * @returns {Array<{placeholder: string, dataUrl: string}>}
 */
export function buildBrandVfsMap(imageAssets) {
  return resolveBrandAssets(imageAssets).map((a) => ({
    placeholder: a.vfsPath,
    dataUrl: a.dataUrl,
  }))
}

/**
 * Render the auto-generated `components/assets.js` file content. Only BRAND
 * roles (logo/hero/photo/illustration) produce exports — aesthetic and
 * structural references are never rendered in the generated site. Base64
 * data URLs are escaped so the template literal is always valid. Each
 * export carries the user's per-image note as a JSDoc comment so the
 * builder LLM sees WHERE to use it.
 *
 * Exports:
 *   LOGO_URL, HERO_URL          — one each (first claimed wins)
 *   PHOTO_0..PHOTO_N            — in upload order
 *   ILLUSTRATION_0..N           — in upload order
 *
 * @param {ReturnType<typeof mapImageAssets>} imageAssets
 * @returns {string}
 */
export function buildAssetsFileContent(imageAssets) {
  if (!Array.isArray(imageAssets) || imageAssets.length === 0) return ''
  const renderable = resolveBrandAssets(imageAssets)
  if (renderable.length === 0) return ''

  const lines = []
  const vfsEntries = []
  for (const a of renderable) {
    const safe = String(a.dataUrl).replace(/`/g, '\\`').replace(/\$/g, '\\$')
    const note = a.note ? `/** ${String(a.note).replace(/\*\//g, '*\\/')} */\n` : ''
    lines.push(`${note}export const ${a.exportName} = \`${safe}\``)
    vfsEntries.push(`  '${a.vfsPath}': ${a.exportName},`)
  }

  return `// AUTO-GENERATED by Auroraly from user-uploaded brand assets.
// Reference as: import { LOGO_URL, HERO_URL, PHOTO_0, ILLUSTRATION_0 } from '../components/assets'
// JSDoc above each export carries the user's placement note — follow it exactly.
// DO NOT EDIT — regenerated on every build.

${lines.join('\n\n')}

// ── Virtual filesystem map ──
// You can ALSO reference these images via public-folder paths, e.g.
//   <img src="/logo.png" />
//   <img src="/hero.jpg" />
//   <img src="/images/photo-0.png" />
// The preview runtime rewrites these paths to the inlined data URLs so
// <img> "just works" with either import OR public-path syntax.
export const VIRTUAL_FS = {
${vfsEntries.join('\n')}
}

if (typeof window !== 'undefined') {
  window.__EMANATOR_VFS__ = Object.assign(window.__EMANATOR_VFS__ || {}, VIRTUAL_FS)
}
`
}
