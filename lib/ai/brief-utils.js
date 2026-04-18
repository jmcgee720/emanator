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
