// ──────────────────────────────────────────────────────────────────────
// Pre-commit syntax validation for self-edit writes
// ──────────────────────────────────────────────────────────────────────
// Catches ~95% of "agent breaks main" syntax-level mistakes BEFORE they
// ever touch GitHub. The v2 agent commits straight to main via the
// GitHub Contents API; if the committed JSX has a missing brace or a
// stray comma the deploy lands as a 500 until someone notices. Parsing
// here fails the write_file tool call instead, the agent sees a
// machine-readable error, and it fixes the file before re-committing.
//
// Scope: .js / .jsx / .ts / .tsx only. Other extensions (JSON, MD, CSS,
// PNG-as-data-URL etc.) skip parsing — they don't have a JS parser
// representation worth running here.
//
// We use @babel/parser (already in node_modules via Next.js) so this
// adds zero new deps. JSON gets a separate try/JSON.parse pass because
// a malformed package.json or tsconfig will also break the build.

import { parse as babelParse } from '@babel/parser'

const JS_LIKE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'])

const BABEL_OPTIONS = {
  sourceType: 'module',
  allowImportExportEverywhere: true,
  allowReturnOutsideFunction: true,
  errorRecovery: false,
  plugins: [
    'jsx',
    'typescript',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'decorators-legacy',
    'dynamicImport',
    'exportDefaultFrom',
    'exportNamespaceFrom',
    'functionBind',
    'numericSeparator',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
    'topLevelAwait',
  ],
}

function getExt(filePath) {
  const i = filePath.lastIndexOf('.')
  return i === -1 ? '' : filePath.slice(i + 1).toLowerCase()
}

/**
 * Run a fast pre-commit syntax check. Returns null on success, or a
 * machine-readable error string the calling tool surfaces to the agent.
 *
 * @param {string} filePath  repo-relative or absolute path
 * @param {string} content   the new file content the agent wants to commit
 * @returns {string|null}    null = OK, string = block with this error
 */
export function syntaxLintBeforeCommit(filePath, content) {
  if (typeof filePath !== 'string' || !filePath) return null
  if (typeof content !== 'string') return null

  // Empty file (deletions) — nothing to parse.
  if (content.length === 0) return null

  const ext = getExt(filePath)

  // JSON: critical for build-time consumption (next.config.js doesn't
  // tolerate a broken package.json or tsconfig.json).
  if (ext === 'json') {
    try {
      JSON.parse(content)
      return null
    } catch (e) {
      return `Invalid JSON in ${filePath}: ${e?.message || 'parse failed'}. The commit was blocked — fix the JSON and try again.`
    }
  }

  if (!JS_LIKE_EXTS.has(ext)) return null

  // Babel parser pass. errorRecovery=false makes the first mistake fatal.
  try {
    babelParse(content, BABEL_OPTIONS)
    return null
  } catch (e) {
    const loc = e?.loc ? ` at line ${e.loc.line}, col ${e.loc.column}` : ''
    const reason = e?.message || 'parse failed'
    return (
      `Syntax error in ${filePath}${loc}: ${reason}. The commit was blocked to protect the live deploy — ` +
      `fix the syntax (often a missing close bracket, unclosed JSX tag, or stray comma) and call the write tool again.`
    )
  }
}
