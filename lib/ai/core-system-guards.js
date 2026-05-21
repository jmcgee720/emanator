/**
 * Core System self-edit guardrails.
 *
 * Loads /app/.auroraly/core-system-guards.json and exposes pure
 * functions for:
 *   - matching a file path against the protected glob list
 *   - matching a package name against the forbidden-add list
 *   - matching a diff body against the kill-switch substring list
 *   - checking whether the current conversation contains a literal
 *     "CONFIRMED: <token>" message authorizing a specific override
 *
 * These functions are invoked by writeFileTool / editFileTool /
 * (future) package.json mutation handlers in agent-tools-v2.js.
 * They run ONLY when the chat is self-edit mode (Core System). They
 * are deliberately conservative: false positives (refusing a legit
 * edit) are far cheaper than false negatives (silently rewriting
 * the auth layer at 1am).
 *
 * Why a literal CONFIRMED: token? The 2026-05-21 NextAuth incident
 * proved that the model can rationalize past prompt-text rules
 * ("the user asked me to fix login, surely a framework swap is
 * within scope"). A literal string the user MUST type defeats
 * rationalization — the model can either find that exact string
 * in the user's recent messages or it cannot. No interpretation.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, '..', '..', '.auroraly', 'core-system-guards.json')

let _cachedConfig = null
function loadConfig() {
  if (_cachedConfig) return _cachedConfig
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8')
    _cachedConfig = JSON.parse(raw)
  } catch (e) {
    // Fail open — if config file is missing/malformed, log loudly but
    // do not block writes. We do NOT want a typo in JSON to brick
    // the entire Core System.
    console.error('[core-system-guards] failed to load config:', e?.message)
    _cachedConfig = {
      forbidden_paths_without_confirmation: [],
      forbidden_package_additions: [],
      force_confirmation_when_diff_contains: [],
    }
  }
  return _cachedConfig
}

/**
 * Convert a glob pattern (limited: **, *, literal) to a RegExp.
 * Only supports the subset we actually use in the config — keeps
 * the implementation small and predictable. Test coverage pins
 * the supported syntax.
 */
function globToRegex(pattern) {
  // Escape regex specials except *, then expand glob wildcards.
  // ** matches across path segments; * matches within a single
  // segment. Anchored to start and end so a stray substring
  // doesn't match too aggressively.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const withGlobs = escaped.replace(/\*\*/g, '__DBLSTAR__').replace(/\*/g, '[^/]*').replace(/__DBLSTAR__/g, '.*')
  return new RegExp('^' + withGlobs + '$')
}

function normalizePath(p) {
  if (!p) return ''
  return String(p).replace(/^\/+/, '').replace(/\\/g, '/').trim()
}

/**
 * @returns {{ guarded: boolean, matchedPattern: string|null }}
 */
export function isPathGuarded(path) {
  const cfg = loadConfig()
  const norm = normalizePath(path)
  for (const pattern of cfg.forbidden_paths_without_confirmation || []) {
    if (globToRegex(pattern).test(norm)) {
      return { guarded: true, matchedPattern: pattern }
    }
  }
  return { guarded: false, matchedPattern: null }
}

/**
 * @returns {{ guarded: boolean, matchedPackages: string[] }}
 *
 * Detects forbidden dependency additions by diffing the new
 * package.json body against the previous one (or just scanning the
 * new content if no previous content is available). Returns the
 * intersection of forbidden packages and packages that appear in
 * the dependencies / devDependencies / peerDependencies blocks.
 */
export function detectForbiddenPackageAdds(newPackageJson, previousPackageJson = null) {
  const cfg = loadConfig()
  const forbidden = new Set(cfg.forbidden_package_additions || [])
  if (forbidden.size === 0) return { guarded: false, matchedPackages: [] }

  let newDeps = {}
  try {
    const parsed = typeof newPackageJson === 'string' ? JSON.parse(newPackageJson) : newPackageJson
    newDeps = {
      ...(parsed?.dependencies || {}),
      ...(parsed?.devDependencies || {}),
      ...(parsed?.peerDependencies || {}),
    }
  } catch {
    // Malformed package.json — let the regular tools error on that
    // rather than blocking it here. We only block intentional
    // dependency additions, not syntax errors.
    return { guarded: false, matchedPackages: [] }
  }

  let prevDeps = {}
  if (previousPackageJson) {
    try {
      const parsed = typeof previousPackageJson === 'string' ? JSON.parse(previousPackageJson) : previousPackageJson
      prevDeps = {
        ...(parsed?.dependencies || {}),
        ...(parsed?.devDependencies || {}),
        ...(parsed?.peerDependencies || {}),
      }
    } catch {
      prevDeps = {}
    }
  }

  const matched = []
  for (const pkg of Object.keys(newDeps)) {
    if (forbidden.has(pkg) && !(pkg in prevDeps)) {
      matched.push(pkg)
    }
  }
  return { guarded: matched.length > 0, matchedPackages: matched }
}

/**
 * Scan a diff/content body for kill-switch substrings (e.g. literal
 * "from 'next-auth'" or "process.env.NEXTAUTH"). Triggered even when
 * the path itself is not in the protected list — useful when the
 * agent tries to import next-auth into a non-protected file like
 * a generic component.
 */
export function detectKillSwitchSubstrings(content) {
  const cfg = loadConfig()
  const triggers = cfg.force_confirmation_when_diff_contains || []
  const matched = triggers.filter((t) => typeof content === 'string' && content.includes(t))
  return { guarded: matched.length > 0, matchedSubstrings: matched }
}

/**
 * Look for a literal "CONFIRMED: <token>" in the recent user
 * messages. token is expected to be the path or the package name
 * the model is about to touch. Match is case-sensitive on CONFIRMED:
 * (the keyword is loud on purpose); the token after the colon is
 * trimmed and compared exactly to the input.
 *
 * @param {Array<{role: string, content: string}>} priorMessages
 * @param {string} token  Path or package name being protected
 * @returns {boolean}
 */
export function hasUserConfirmation(priorMessages, token) {
  if (!Array.isArray(priorMessages) || !token) return false
  const trimmedToken = String(token).trim()
  // Only consider the most recent ~20 messages — older confirmations
  // do not carry forward indefinitely. The user must re-confirm in
  // each new "edit-protected-file" episode.
  const recent = priorMessages.slice(-20)
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]
    if (!m || m.role !== 'user') continue
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n')
        : ''
    // Find each "CONFIRMED: <token>" line (multiple may be on one
    // message if the user is approving several paths at once).
    const lines = text.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('CONFIRMED:')) continue
      const after = trimmed.slice('CONFIRMED:'.length).trim()
      // Exact match OR prefix match for path-with-glob convenience
      // (e.g. user typed CONFIRMED: components/auth and the model
      // wants to write components/auth/LoginPage.jsx — accept).
      if (after === trimmedToken) return true
      if (trimmedToken.startsWith(after + '/')) return true
    }
  }
  return false
}

/**
 * Build the standard refusal-with-instructions message returned by
 * the tool when a write is blocked. Centralized so the wording is
 * consistent across writeFile / editFile / future hooks, and so
 * tests can assert against it.
 */
export function buildGuardRefusalMessage({ kind, path, matchedPattern, matchedPackages, matchedSubstrings }) {
  if (kind === 'path') {
    return [
      `PROTECTED PATH — write refused.`,
      `Path: ${path}`,
      `Matched guard: ${matchedPattern}`,
      ``,
      `This path is on the Core System protected list because changes to it have caused production outages in the past (auth/payment/middleware/env config).`,
      ``,
      `Required to proceed:`,
      `  1. STOP. Do NOT retry write_file or edit_file on this path.`,
      `  2. Reply to the user with: (a) what you intend to change, (b) why, (c) what could break.`,
      `  3. Wait for the user to literally reply with: CONFIRMED: ${path}`,
      `     (or a parent prefix, e.g. CONFIRMED: ${matchedPattern.replace(/\*\*?$/, '').replace(/\/$/, '') || matchedPattern})`,
      `  4. Only after that literal CONFIRMED line appears in the user's most recent message may you retry the write.`,
      ``,
      `Vague approval ("sure", "yes", "go ahead") does NOT satisfy this gate. The exact CONFIRMED: token is required by design.`,
    ].join('\n')
  }
  if (kind === 'package') {
    return [
      `PROTECTED DEPENDENCY ADDITION — write refused.`,
      `Packages: ${(matchedPackages || []).join(', ')}`,
      ``,
      `Adding these dependencies has historically led to large-scale rewrites of working systems (e.g. swapping Supabase auth for next-auth without configuring env vars). Most "I want auth like X" requests are better solved by debugging the existing integration than by adding a new one.`,
      ``,
      `Required to proceed:`,
      `  1. STOP. Do NOT retry the package.json write.`,
      `  2. Reply to the user with a short plan: what you would add, why the existing setup cannot be debugged instead, what env vars are required, what user sessions would be invalidated.`,
      `  3. Wait for the user to literally reply with: CONFIRMED: ${(matchedPackages || ['<package>'])[0]}`,
      `  4. Only after that literal CONFIRMED line appears in the user's most recent message may you retry the write.`,
    ].join('\n')
  }
  if (kind === 'kill_switch') {
    return [
      `PROTECTED CODE PATTERN — write refused.`,
      `Detected substrings: ${(matchedSubstrings || []).map((s) => `"${s}"`).join(', ')}`,
      ``,
      `These literal strings indicate a high-blast-radius change (auth replacement, session disabling, env-var-dependent secret config). Even when the destination file is not itself on the protected list, the substrings tell us the change touches auth/payment/middleware semantics.`,
      ``,
      `Required to proceed:`,
      `  1. STOP. Reply to the user with the proposed change and rationale.`,
      `  2. Wait for: CONFIRMED: ${(matchedSubstrings || ['<substring>'])[0]}`,
      `  3. Then retry.`,
    ].join('\n')
  }
  return 'Write refused by Core System guards.'
}
