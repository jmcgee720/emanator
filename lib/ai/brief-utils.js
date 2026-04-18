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
 * Map raw image attachments to role-tagged assets the builder can reference
 * by import name (LOGO_URL / HERO_URL / REFERENCE_N). Caps at 4 images.
 * Roles are heuristic: filename hints like "logo" / "hero" win, then first
 * upload in a small batch is treated as the logo.
 *
 * @param {Array<{data: string, name?: string, filename?: string}>} attachments
 * @returns {Array<{role: 'logo'|'hero'|'reference', name: string, dataUrl: string, index: number}>}
 */
export function mapImageAssets(attachments) {
  const imgs = (attachments || []).filter((a) => a && a.data)
  return imgs.slice(0, 4).map((att, idx) => {
    const name = (att.name || att.filename || '').toLowerCase()
    let role = 'reference'
    if (/logo|mark|icon|brand/.test(name)) role = 'logo'
    else if (/hero|banner|cover|header/.test(name)) role = 'hero'
    else if (idx === 0 && imgs.length <= 2) role = 'logo'
    const ext = (name.split('.').pop() || 'png').toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : ext === 'svg' ? 'image/svg+xml'
      : 'image/png'
    const dataUrl = att.data.startsWith('data:') ? att.data : `data:${mime};base64,${att.data}`
    return { role, name: att.name || `image_${idx}`, dataUrl, index: idx }
  })
}

/**
 * Render the auto-generated `components/assets.js` file content. Base64 data
 * URLs can be very long so we bypass the LLM and write them directly — any
 * backticks or `$` inside the data URL are escaped so the template literal
 * is always valid.
 *
 * @param {ReturnType<typeof mapImageAssets>} imageAssets
 * @returns {string}
 */
export function buildAssetsFileContent(imageAssets) {
  if (!Array.isArray(imageAssets) || imageAssets.length === 0) return ''
  const lines = imageAssets.map((a) => {
    const exportName = a.role === 'logo' ? 'LOGO_URL'
      : a.role === 'hero' ? 'HERO_URL'
      : `REFERENCE_${a.index}`
    const safe = String(a.dataUrl).replace(/`/g, '\\`').replace(/\$/g, '\\$')
    return `export const ${exportName} = \`${safe}\``
  })
  return `// AUTO-GENERATED by Emanator from user-uploaded reference images.\n// Reference as: import { LOGO_URL, HERO_URL, REFERENCE_0 } from '../components/assets'\n// DO NOT EDIT — regenerated on every build.\n\n${lines.join('\n\n')}\n`
}
