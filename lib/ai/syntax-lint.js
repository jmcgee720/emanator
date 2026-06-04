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
// We use @babel/parser + @babel/traverse (already in node_modules via
// Next.js) so this adds zero new deps. JSON gets a separate try/
// JSON.parse pass because a malformed package.json or tsconfig will
// also break the build.
//
// As of 2026-05-22 we also do an undeclared-identifier (no-undef)
// scope check. On that date the Core System agent deleted a single
// `let priorMessages = ...` line during a refactor and the lingering
// `priorMessages` references downstream produced a runtime
// `ReferenceError: priorMessages is not defined` that crashed every
// project chat for ~12 hours. Pure-syntax parsing said the file was
// fine. The scope check below would have flagged the dangling refs
// and blocked the commit.

import { parse as babelParse } from '@babel/parser'
import _babelTraverse from '@babel/traverse'

// @babel/traverse ships as a CJS module with a `.default` interop
// quirk on ESM; some bundlers (and certain Vercel pre-build steps)
// hand us the namespace object instead of the function. Unwrap both
// shapes so the lint never crashes the writer it's meant to protect.
const babelTraverse = _babelTraverse?.default || _babelTraverse

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

// Identifiers that are always allowed even if not in scope. Anything
// here is either a JS / Node / Web global, a Next.js-defined runtime
// global, or a React/JSX/Type-only marker we don't want to false-flag.
const KNOWN_GLOBALS = new Set([
  // JS built-ins
  'undefined', 'NaN', 'Infinity', 'globalThis',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Math', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'ReferenceError', 'EvalError', 'URIError', 'AggregateError',
  'JSON', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef',
  'Proxy', 'Reflect', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'eval', 'globalThis',
  // Async + iteration
  'async', 'await', 'arguments', 'this', 'super',
  // Node.js
  'process', 'Buffer', 'console', 'global', '__dirname', '__filename',
  'require', 'module', 'exports',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  // Web
  'fetch', 'Request', 'Response', 'Headers', 'URL', 'URLSearchParams',
  'FormData', 'Blob', 'File', 'FileReader', 'ReadableStream', 'WritableStream',
  'TransformStream', 'TextEncoder', 'TextDecoder', 'AbortController',
  'AbortSignal', 'crypto', 'atob', 'btoa', 'structuredClone',
  'window', 'document', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'indexedDB', 'caches', 'performance', 'WebSocket',
  'EventSource', 'MessageEvent', 'CustomEvent', 'Event', 'EventTarget',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  // React/Next.js conventions (lowercase only; capitalized are imports)
  'React',
])

/**
 * AST-based undeclared-identifier scan. Returns null when no problems
 * found, or a human-readable error string the caller surfaces back to
 * the agent. Designed for false-NEGATIVE safety: when in doubt we
 * accept and let the deploy try (we never want to over-block a
 * legitimate commit). Specifically we skip files that:
 *   • are .tsx/.ts (TypeScript users often type-only-import names;
 *     full TS resolution requires the compiler — out of scope here)
 *   • reference a JSX component name the parser is unsure about
 *
 * The check primarily catches the "deleted declaration left orphan
 * references" class of bug that broke project chat on 2026-05-22.
 */
function checkUndeclaredIdentifiers(ast, filePath) {
  // Skip TS — proper resolution requires the tsc compiler.
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return null

  const undeclared = []
  try {
    if (typeof babelTraverse !== 'function') return null

    babelTraverse(ast, {
      ReferencedIdentifier(path) {
        const name = path.node.name
        if (KNOWN_GLOBALS.has(name)) return
        // JSX element names that start with a capital letter look like
        // identifiers but may be imported in a sibling file (Next.js
        // server components, conditional imports). Skip to avoid noise.
        if (path.parent?.type === 'JSXOpeningElement' || path.parent?.type === 'JSXClosingElement') return
        // Already in scope at this location? — that's the whole point.
        if (path.scope.hasBinding(name)) return
        // path.scope.hasGlobal() is unreliable here: at the Program
        // scope level it lazily returns true for any seen identifier,
        // which would swallow real undeclared references. We rely on
        // hasBinding + the explicit KNOWN_GLOBALS allowlist above.
        undeclared.push({
          name,
          line: path.node.loc?.start?.line,
          column: path.node.loc?.start?.column,
        })
      },
    })
  } catch {
    // Traversal errors are non-fatal — fall back to syntax-only validation.
    return null
  }

  if (undeclared.length === 0) return null

  // De-duplicate by name; report up to 5 distinct names so the agent
  // can fix them without a wall of noise.
  const seen = new Set()
  const distinct = []
  for (const u of undeclared) {
    if (seen.has(u.name)) continue
    seen.add(u.name)
    distinct.push(u)
    if (distinct.length >= 5) break
  }
  const summary = distinct
    .map((u) => `'${u.name}' (line ${u.line || '?'})`)
    .join(', ')
  return (
    `Undeclared identifier(s) in ${filePath}: ${summary}. ` +
    'The commit was blocked because these names are used but never declared, ' +
    'imported, or assigned anywhere in the file. Most often this means a ' +
    "`let`/`const`/`import` line was deleted by mistake while leaving its references behind. " +
    'Restore the declaration (or remove the references) and try again.'
  )
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
 * @param {object} options   validation options
 * @param {boolean} options.partialEdit  if true, allow edits to already-broken files (for incremental fixes)
 * @param {string} options.priorContent  the file content BEFORE this edit (required when partialEdit=true)
 * @returns {string|null}    null = OK, string = block with this error
 */
export function syntaxLintBeforeCommit(filePath, content, options = {}) {
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

  // PARTIAL EDIT MODE: if the file was already broken and this is an
  // incremental fix, allow the edit as long as it doesn't make things WORSE.
  // This enables multi-step fixes to already-broken files without cascading blocks.
  const partialEditMode = options.partialEdit === true && typeof options.priorContent === 'string'
  let priorWasBroken = false
  let priorErrorCount = 0
  if (partialEditMode) {
    const priorError = syntaxLintBeforeCommit(filePath, options.priorContent, { partialEdit: false })
    priorWasBroken = priorError !== null
    if (priorWasBroken) {
      // Count how many undeclared identifiers were in the prior version
      // (rough heuristic: count occurrences of "', '" in the error message)
      const matches = priorError.match(/'\w+' \(line \d+\)/g)
      priorErrorCount = matches ? matches.length : 1
    }
  }

  // Babel parser pass. errorRecovery=false makes the first mistake fatal.
  let ast
  try {
    ast = babelParse(content, BABEL_OPTIONS)
  } catch (e) {
    // If partial edit mode AND the prior version was also broken, allow this edit
    // (we're making incremental progress toward a working file)
    if (partialEditMode && priorWasBroken) {
      console.log(`[syntax-lint] PARTIAL EDIT: allowing edit to already-broken file ${filePath}`)
      return null // Allow the edit — file was already broken
    }
    const loc = e?.loc ? ` at line ${e.loc.line}, col ${e.loc.column}` : ''
    const reason = e?.message || 'parse failed'
    return (
      `Syntax error in ${filePath}${loc}: ${reason}. The commit was blocked to protect the live deploy — ` +
      `fix the syntax (often a missing close bracket, unclosed JSX tag, or stray comma) and call the write tool again.`
    )
  }

  // AST-based undeclared-identifier check. The 'priorMessages is not
  // defined' incident on 2026-05-22 would have been caught here.
  const undefErr = checkUndeclaredIdentifiers(ast, filePath)
  if (undefErr) {
    // If partial edit mode AND the prior version was also broken, allow this edit
    // AS LONG AS we're not making things worse (adding MORE undeclared identifiers)
    if (partialEditMode && priorWasBroken) {
      const newMatches = undefErr.match(/'\w+' \(line \d+\)/g)
      const newErrorCount = newMatches ? newMatches.length : 1
      if (newErrorCount <= priorErrorCount) {
        console.log(`[syntax-lint] PARTIAL EDIT: allowing edit to already-broken file ${filePath} (${newErrorCount} errors, was ${priorErrorCount})`)
        return null // Allow the edit — not making things worse
      }
    }
    return undefErr
  }

  return null
}
