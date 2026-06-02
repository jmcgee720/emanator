// ── Agent Tools v2 ──
// Clean, scope-bounded tool implementations for the v2 agent core.
//
// Each tool is a factory function: pass in a `scope` and get back a tool
// definition { name, description, input_schema, execute }.
//
// Scope shape:
//   {
//     rootDirs:     string[]   // absolute paths the tool may read/write under
//     excludePaths: string[]   // absolute paths to refuse (node_modules, .git, etc)
//     maxFileBytes: number     // safety cap for reads (default 200 KB)
//     execTimeoutMs:number     // safety cap for run_command (default 15s)
//   }
//
// No directive injection. No auto-recovery. No fuzzy-find. Tools return
// raw, accurate results. If the model wants to recover, it calls another
// tool. This is the entire point of the v2 design.

import fs from 'node:fs'
import path from 'node:path'
import { isPathGuarded, detectForbiddenPackageAdds, detectKillSwitchSubstrings, hasUserConfirmation, buildGuardRefusalMessage } from './core-system-guards.js'
import { webSearchTool } from './tools/web-search.js'
import { CORE_ARCHITECTURE, OPERATIONAL_PATTERNS, FAILURE_MODES } from './core-system-awareness.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const DEFAULT_MAX_FILE_BYTES = 200 * 1024
const DEFAULT_EXEC_TIMEOUT_MS = 15_000

/* ─────────────────────────── scope helpers ─────────────────────────── */

export function normalizeScope(scope = {}) {
  return {
    rootDirs: (scope.rootDirs || []).map((p) => path.resolve(p)),
    excludePaths: (scope.excludePaths || []).map((p) => path.resolve(p)),
    maxFileBytes: scope.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    execTimeoutMs: scope.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
  }
}

export function resolveInScope(scope, requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') {
    throw new Error('path must be a non-empty string')
  }
  // Reject obvious traversal attempts in the input (before resolution)
  if (requestedPath.includes('\0')) throw new Error('path contains null byte')

  // Build an absolute resolution; relative paths anchor to first rootDir.
  const abs = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(scope.rootDirs[0] || process.cwd(), requestedPath)

  // Reject excluded paths
  for (const ex of scope.excludePaths) {
    if (abs === ex || abs.startsWith(ex + path.sep)) {
      throw new Error(`path "${requestedPath}" is in an excluded directory`)
    }
  }
  // Require the resolved path to live under at least one root
  const inRoot = scope.rootDirs.some(
    (root) => abs === root || abs.startsWith(root + path.sep)
  )
  if (!inRoot) {
    throw new Error(
      `path "${requestedPath}" is out of scope (allowed roots: ${scope.rootDirs.join(', ')})`
    )
  }
  return abs
}

function addLineNumbers(content) {
  const lines = content.split('\n')
  const width = String(lines.length).length
  return lines.map((l, i) => `${String(i + 1).padStart(width)}| ${l}`).join('\n')
}

/**
 * Translate a scope-relative or absolute path into a repo-relative path.
 * Strips the first scope root prefix so "/var/task/lib/foo.js" → "lib/foo.js".
 */
function toRepoPath(scope, reqPath) {
  if (!path.isAbsolute(reqPath)) return reqPath.replace(/^\/+/, '')
  const root = scope.rootDirs[0]
  if (root && reqPath.startsWith(root + path.sep)) {
    return reqPath.slice(root.length + 1)
  }
  return reqPath.replace(/^\/+/, '')
}

/* ───────────────────────────── tools ───────────────────────────────── */

export function readFileTool(rawScope, reader = null) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'read_file',
    description: reader
      ? `Read a file from ${reader.repo}@${reader.branch} via GitHub. Returns content with line numbers prepended. Use BEFORE editing a file.

⚠️ CRITICAL — DO NOT PASTE FILE CONTENT IN YOUR RESPONSE ⚠️
The tool result is for YOUR ANALYSIS ONLY. The user does NOT see tool results. After calling read_file, respond with a BRIEF summary (1-2 sentences) and your next action. NEVER paste code blocks or line numbers in your text response — that wastes thousands of tokens and makes chats hit the 200k context limit too quickly.`
      : `Read the contents of a file. Returns content with line numbers prepended. Use BEFORE editing a file.

⚠️ CRITICAL — DO NOT PASTE FILE CONTENT IN YOUR RESPONSE ⚠️
The tool result is for YOUR ANALYSIS ONLY. The user does NOT see tool results. After calling read_file, respond with a BRIEF summary (1-2 sentences) and your next action. NEVER paste code blocks or line numbers in your text response — that wastes thousands of tokens.`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or root-relative path to the file' },
      },
      required: ['path'],
    },
    async execute({ path: reqPath }) {
      // ── Binary-content short-circuit (added 2026-05-28) ─────────────
      // When a user attaches an image in a project chat, the upload
      // route stores the data URL (data:image/png;base64,...) as the
      // file's content so the preview iframe can serve it back. But
      // when the model calls read_file on that same path, it gets a
      // 200KB base64 blob that it MISREADS as "I'm seeing the image".
      // It then narrates fabricated contents from the file path alone
      // (this was the 2026-05-28 user report — Auroraly "analysed"
      // a Nexsara runtime error screenshot by reading the base64 and
      // confidently making up the contents). Short-circuit here: if
      // the file content is a base64 data URL, return a sharp message
      // pointing the model at the vision input it already received.
      const readResult = await (async () => {
        if (reader) {
          const repoPath = toRepoPath(scope, reqPath)
          return await reader.readFile(repoPath, scope.maxFileBytes)
        }
        const abs = resolveInScope(scope, reqPath)
        const stat = fs.statSync(abs)
        if (!stat.isFile()) throw new Error(`"${reqPath}" is not a file`)
        const raw = fs.readFileSync(abs, 'utf-8')
        const truncated = raw.length > scope.maxFileBytes
        const content = truncated
          ? raw.slice(0, scope.maxFileBytes) + '\n[truncated at ' + scope.maxFileBytes + ' bytes]'
          : raw
        const lineCount = raw.split('\n').length
        return { content, lineCount, source: abs }
      })()

      // Detect base64 data URLs (any media type). The "data:" prefix
      // plus ";base64," is unambiguous — no legitimate source file
      // starts with that. Also catch the case where the data URL was
      // already truncated by the underlying reader, leaving the prefix
      // intact at the start.
      const head = readResult.content.slice(0, 80)
      const dataUrlMatch = head.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,/i)
      if (dataUrlMatch) {
        const mediaType = dataUrlMatch[1]
        const kind = mediaType.startsWith('image/')
          ? 'image'
          : mediaType === 'application/pdf'
            ? 'PDF'
            : 'binary'
        return [
          `BINARY FILE — ${readResult.source}`,
          `Media type: ${mediaType}`,
          '',
          `This file's contents are stored as a base64 data URL so the preview iframe can serve them back to the browser. read_file is NOT how you analyse ${kind} contents.`,
          '',
          kind === 'image'
            ? 'The image bytes were ALREADY sent to you as a vision content block on the user message that uploaded this file (current turn if just uploaded; recent-history turns are also preserved). Look at the actual image you can see — do NOT attempt to interpret the base64 string, and do NOT fabricate contents based on the filename or path.'
            : kind === 'PDF'
              ? 'For PDFs, the server-extracted text was provided as a text content block on the user message that uploaded this file. Reference that text — do not interpret the base64 here.'
              : 'Binary contents cannot be meaningfully analysed via read_file. If you need the contents, ask the user to re-upload as a text file or screenshot.',
          '',
          `If you only needed the file PATH to reference in code (e.g. <img src="${readResult.source.includes('/public/') ? readResult.source.split('/public')[1] || readResult.source : readResult.source}" />), use the path as-is. You do not need to read the binary contents to reference them.`,
        ].join('\n')
      }
      // ─────────────────────────────────────────────────────────────────

      return `${readResult.source} (${readResult.lineCount} lines)\n\n\`\`\`\n${addLineNumbers(readResult.content)}\n\`\`\``
    },
  }
}

export function writeFileTool(rawScope, writer = null, guardCtx = null) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'write_file',
    description:
      writer && writer.isConfigured === false
        ? 'Write a file. NOTE: this environment requires GitHub-backed writes but the writer is not configured — calls will return setup instructions.'
        : writer
          ? `Create or overwrite a file. Changes are committed to ${writer.repo}@${writer.branch} via the GitHub API; the deployment auto-redeploys. Use for new files or full rewrites; use edit_file for surgical changes.`
          : 'Write a NEW file or COMPLETELY overwrite an existing one. For surgical edits to existing files, use edit_file instead.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or root-relative path' },
        content: { type: 'string', description: 'Full file content' },
        message: { type: 'string', description: 'Optional commit message (GitHub-backed environments only)' },
      },
      required: ['path', 'content'],
    },
    async execute({ path: reqPath, content, message }) {
      if (typeof content !== 'string') throw new Error('content must be a string')

      // ── Core System self-edit guards ───────────────────────────────
      // Only runs in self-edit mode (Core System). Project chats are
      // unaffected. Three checks in order:
      //   (1) is the destination path on the protected list?
      //   (2) does the diff contain a kill-switch substring?
      //   (3) if writing package.json, are we adding a forbidden dep?
      // Each requires a literal `CONFIRMED: <token>` in the user's
      // recent messages or the write is refused with instructions.
      if (guardCtx?.isSelfEdit) {
        const pathGuard = isPathGuarded(reqPath)
        if (pathGuard.guarded && !hasUserConfirmation(guardCtx.priorMessages, reqPath)) {
          throw new Error(buildGuardRefusalMessage({
            kind: 'path', path: reqPath, matchedPattern: pathGuard.matchedPattern,
          }))
        }
        const ks = detectKillSwitchSubstrings(content)
        if (ks.guarded && !hasUserConfirmation(guardCtx.priorMessages, ks.matchedSubstrings[0])) {
          throw new Error(buildGuardRefusalMessage({
            kind: 'kill_switch', matchedSubstrings: ks.matchedSubstrings,
          }))
        }
        // package.json dependency check — only fires when writing
        // package.json itself.
        if (/(^|\/)package\.json$/.test(reqPath)) {
          // Try to read the previous content to do a real diff. If we
          // cannot, fall back to scanning the new content alone.
          let previousContent = null
          try {
            if (writer && typeof writer.readFile === 'function') {
              previousContent = await writer.readFile(toRepoPath(scope, reqPath)).catch(() => null)
            } else {
              const abs = resolveInScope(scope, reqPath)
              if (fs.existsSync(abs)) previousContent = fs.readFileSync(abs, 'utf-8')
            }
          } catch { /* swallow — fall back to new-only scan */ }
          const pkgGuard = detectForbiddenPackageAdds(content, previousContent)
          const firstMatched = pkgGuard.matchedPackages?.[0]
          if (pkgGuard.guarded && firstMatched && !hasUserConfirmation(guardCtx.priorMessages, firstMatched)) {
            throw new Error(buildGuardRefusalMessage({
              kind: 'package', matchedPackages: pkgGuard.matchedPackages,
            }))
          }
        }
      }

      // Tripwire: detect binary payloads being smuggled through the
      // text-only write_file tool. Models will sometimes paste a data
      // URL (or just the raw base64 body of one) into `content`. That
      // used to silently land on disk as a 60-byte stub. Fail loud
      // instead, and point the model at the binary-safe tool.
      if (/^data:[a-zA-Z0-9+\-./]+;base64,/.test(content)) {
        throw new Error(
          'write_file received a base64 data URL — that is a binary payload. ' +
          'Do NOT pass binaries through write_file. Use the save_attachment_to_path ' +
          'tool with the attachment_index (or attachment_filename) of the file the user ' +
          'uploaded on the current turn.'
        )
      }
      // Heuristic for raw base64 with no data: prefix. >2KB of pure
      // base64 alphabet with the right length-multiple is almost
      // certainly a binary, never source code.
      if (content.length > 2048 && /^[A-Za-z0-9+/\s]+={0,2}$/.test(content) && (content.replace(/\s/g, '').length % 4 === 0)) {
        throw new Error(
          'write_file received what looks like raw base64 — that is a binary payload. ' +
          'Use the save_attachment_to_path tool with the attachment_index of the file ' +
          'the user uploaded.'
        )
      }
      if (writer) {
        // Validate the path is in scope (still applies — repo paths must be sane)
        resolveInScope(scope, reqPath)
        const repoPath = toRepoPath(scope, reqPath)
        return writer.writeFile(repoPath, content, message)
      }
      const abs = resolveInScope(scope, reqPath)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content, 'utf-8')
      return `Wrote ${abs} (${content.length} bytes)`
    },
  }
}

export function editFileTool(rawScope, writer = null, guardCtx = null) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'edit_file',
    description:
      writer && writer.isConfigured === false
        ? 'Edit a file. NOTE: this environment requires GitHub-backed writes but the writer is not configured — calls will return setup instructions.'
        : writer
          ? `Replace EXACT unique text in an existing file. Change is committed to ${writer.repo}@${writer.branch}; the deployment auto-redeploys. old_str must appear exactly once.`
          : 'Replace EXACT text in an existing file. old_str must appear exactly once. For multiple edits, call this tool multiple times.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_str: { type: 'string', description: 'Exact existing text to replace (must be unique in the file)' },
        new_str: { type: 'string', description: 'Replacement text' },
        message: { type: 'string', description: 'Optional commit message (GitHub-backed environments only)' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
    async execute({ path: reqPath, old_str, new_str, message }) {
      if (typeof old_str !== 'string' || old_str.length === 0) {
        throw new Error('old_str must be a non-empty string')
      }

      // ── Core System self-edit guards (path + kill-switch on new_str)
      // edit_file does not have a `content` parameter, so we run the
      // kill-switch scan against new_str (the replacement body). Path
      // guard runs against reqPath as usual. package.json dep-add
      // detection only fires from write_file since adding a dep
      // through edit_file is much rarer and harder to misread.
      if (guardCtx?.isSelfEdit) {
        const pathGuard = isPathGuarded(reqPath)
        if (pathGuard.guarded && !hasUserConfirmation(guardCtx.priorMessages, reqPath)) {
          throw new Error(buildGuardRefusalMessage({
            kind: 'path', path: reqPath, matchedPattern: pathGuard.matchedPattern,
          }))
        }
        const ks = detectKillSwitchSubstrings(new_str || '')
        if (ks.guarded && !hasUserConfirmation(guardCtx.priorMessages, ks.matchedSubstrings[0])) {
          throw new Error(buildGuardRefusalMessage({
            kind: 'kill_switch', matchedSubstrings: ks.matchedSubstrings,
          }))
        }
      }

      if (writer) {
        resolveInScope(scope, reqPath)
        const repoPath = toRepoPath(scope, reqPath)
        return writer.editFile(repoPath, old_str, new_str, message)
      }
      const abs = resolveInScope(scope, reqPath)
      if (!fs.existsSync(abs)) throw new Error(`"${reqPath}" does not exist`)
      const raw = fs.readFileSync(abs, 'utf-8')
      const idx = raw.indexOf(old_str)
      if (idx === -1) throw new Error(`old_str not found in "${reqPath}"`)
      const second = raw.indexOf(old_str, idx + old_str.length)
      if (second !== -1) {
        throw new Error(`old_str matches in multiple locations in "${reqPath}" — include more surrounding context to make it unique`)
      }
      const next = raw.slice(0, idx) + (new_str || '') + raw.slice(idx + old_str.length)
      fs.writeFileSync(abs, next, 'utf-8')
      return `Edited ${abs}: replaced 1 occurrence (${old_str.length} → ${(new_str || '').length} bytes)`
    },
  }
}

export function runCommandTool(rawScope) {
  const scope = normalizeScope(rawScope)
  const cwd = scope.rootDirs[0] || process.cwd()
  return {
    name: 'run_command',
    description:
      'Execute a shell command. Use this to find files, grep, list directories, or anything else the other tools do not cover. Output is truncated to 10 KB. NEVER include credentials, API tokens, or secrets in the command — they will be logged.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The full shell command to run' },
      },
      required: ['command'],
    },
    async execute({ command }) {
      if (typeof command !== 'string' || !command.trim()) {
        throw new Error('command must be a non-empty string')
      }
      // ── Credential leak guard ─────────────────────────────────────
      // Refuse commands that contain what looks like a real auth token
      // on the command line. The agent should use configured env vars
      // (GITHUB_TOKEN etc.) via the file tools, never pass tokens
      // directly through curl / a shell invocation that gets logged
      // into the chat transcript.
      const TOKEN_PATTERNS = [
        /\bghp_[A-Za-z0-9]{20,}\b/,           // GitHub classic PAT
        /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,   // GitHub fine-grained PAT
        /\bsk-[A-Za-z0-9]{20,}\b/,            // OpenAI / Anthropic-style keys
        /\bxoxb-[A-Za-z0-9-]{20,}\b/,          // Slack bot tokens
        /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/, // long JWTs
      ]
      for (const re of TOKEN_PATTERNS) {
        if (re.test(command)) {
          throw new Error(
            'run_command refused: the command contains what looks like a credential (PAT / API key / JWT). ' +
            'Never paste tokens on the command line — they get logged into the chat transcript. ' +
            'If you need authenticated access, use the configured tools (read_file / write_file / edit_file) ' +
            'which use server-side env vars. If a tool is missing functionality, ask the user to add it.'
          )
        }
      }
      try {
        const { stdout, stderr } = await execFileP('/bin/sh', ['-c', command], {
          cwd,
          timeout: scope.execTimeoutMs,
          maxBuffer: 1024 * 1024,
        })
        const out = (stdout || '') + (stderr ? '\n[stderr]\n' + stderr : '')
        const clipped = out.length > 10_000 ? out.slice(0, 10_000) + '\n[truncated at 10KB]' : out
        return clipped || '(no output)'
      } catch (err) {
        const stdout = err.stdout || ''
        const stderr = err.stderr || ''
        const code = err.code != null ? err.code : 'unknown'
        return `[command failed: exit ${code}]\nstdout:\n${stdout}\nstderr:\n${stderr}`.slice(0, 10_000)
      }
    },
  }
}

export function deleteFileTool(rawScope, writer = null) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'delete_file',
    description:
      writer && writer.isConfigured === false
        ? 'Delete a file. NOTE: this environment requires GitHub-backed writes but the writer is not configured — calls will return setup instructions.'
        : writer
          ? `Delete a file from ${writer.repo}@${writer.branch}. The deployment auto-redeploys after the commit. Idempotent: deleting a missing file returns success.`
          : 'Delete a file. Idempotent: deleting a missing file returns success.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or root-relative path to delete' },
        message: { type: 'string', description: 'Optional commit message (GitHub-backed environments only)' },
      },
      required: ['path'],
    },
    async execute({ path: reqPath, message }) {
      if (writer) {
        resolveInScope(scope, reqPath)
        const repoPath = toRepoPath(scope, reqPath)
        if (typeof writer.deleteFile !== 'function') {
          throw new Error('this writer does not support deletes')
        }
        return writer.deleteFile(repoPath, message)
      }
      const abs = resolveInScope(scope, reqPath)
      if (!fs.existsSync(abs)) {
        return `${reqPath} was not present (already deleted or never existed).`
      }
      // Refuse to recursively wipe directories from a single tool call —
      // forces the model to be deliberate about each file it removes.
      const stat = fs.statSync(abs)
      if (stat.isDirectory()) {
        throw new Error(`"${reqPath}" is a directory; this tool only deletes individual files`)
      }
      fs.unlinkSync(abs)
      return `Deleted ${abs}`
    },
  }
}

export function searchFilesTool(rawScope, reader = null) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'search_files',
    description: reader
      ? `Search file contents in ${reader.repo}@${reader.branch} via GitHub Code Search. Returns matching file paths with permalinks.`
      : 'Search file contents recursively for a pattern (grep). Returns matching file paths with line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Literal text or regex to search for' },
        path: { type: 'string', description: 'Optional root path (defaults to first scope root)' },
      },
      required: ['pattern'],
    },
    async execute({ pattern, path: searchPath }) {
      if (typeof pattern !== 'string' || !pattern) throw new Error('pattern is required')
      if (reader) {
        const basePath = searchPath ? toRepoPath(scope, searchPath) : null
        return reader.searchFiles(pattern, basePath)
      }
      const base = searchPath ? resolveInScope(scope, searchPath) : scope.rootDirs[0]
      const exclArgs = scope.excludePaths
        .map((ex) => `--exclude-dir=${path.basename(ex)}`)
        .join(' ')
      const cmd = `grep -rnIE ${exclArgs} -- ${JSON.stringify(pattern)} ${JSON.stringify(base)} 2>/dev/null | head -50`
      try {
        const { stdout } = await execFileP('/bin/sh', ['-c', cmd], {
          timeout: scope.execTimeoutMs,
          maxBuffer: 1024 * 1024,
        })
        return (stdout || '').trim() || `(no matches for "${pattern}" in ${base})`
      } catch (err) {
        return `(no matches or error: ${err?.message || 'unknown'})`
      }
    },
  }
}

export function listFilesTool(rawScope, reader = null) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'list_files',
    description: reader
      ? `List files matching a name pattern in ${reader.repo}@${reader.branch} via GitHub. Useful when you don't know the exact path.`
      : 'List files matching a name pattern (find -name). Useful for locating a file when you do not know the exact path.',
    input_schema: {
      type: 'object',
      properties: {
        name_pattern: { type: 'string', description: "Glob pattern, e.g. '*.js' or 'message-stream.js'" },
        path: { type: 'string', description: 'Optional root path (defaults to first scope root)' },
      },
      required: ['name_pattern'],
    },
    async execute({ name_pattern, path: searchPath }) {
      if (typeof name_pattern !== 'string' || !name_pattern) throw new Error('name_pattern is required')
      if (reader) {
        const basePath = searchPath ? toRepoPath(scope, searchPath) : null
        const matches = await reader.listFiles(name_pattern, basePath)
        if (!matches || matches.length === 0) {
          return `(no files match "${name_pattern}" in ${reader.repo}@${reader.branch})`
        }
        return matches.join('\n')
      }
      const base = searchPath ? resolveInScope(scope, searchPath) : scope.rootDirs[0]
      const exclArgs = scope.excludePaths
        .map((ex) => `-not -path ${JSON.stringify(ex + '/*')}`)
        .join(' ')
      const safePattern = name_pattern.replace(/[^a-zA-Z0-9._*?-]/g, '')
      const cmd = `find ${JSON.stringify(base)} -type f -name '${safePattern}' ${exclArgs} 2>/dev/null | head -50`
      try {
        const { stdout } = await execFileP('/bin/sh', ['-c', cmd], {
          timeout: scope.execTimeoutMs,
          maxBuffer: 1024 * 1024,
        })
        return (stdout || '').trim() || `(no files match "${name_pattern}" under ${base})`
      } catch (err) {
        return `(no matches or error: ${err?.message || 'unknown'})`
      }
    },
  }
}

/**
 * Self-diagnostic tool — verify the agent's own configuration.
 * Checks: file I/O mode, GitHub credentials, scope, available tools.
 * Use this when the agent is confused about its own capabilities.
 */
export function selfDiagnosticTool(rawScope, writer, reader) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'self_diagnostic',
    description: 'Run a self-diagnostic to verify your own configuration (file I/O mode, GitHub credentials, scope, tools). Use this when you are unsure about your capabilities or when writes are failing.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute() {
      const parts = []
      
      parts.push('## SELF-DIAGNOSTIC REPORT')
      parts.push('')
      
      // File I/O mode
      parts.push('**File I/O Mode**:')
      if (writer && writer.repo) {
        parts.push(`  ✅ GitHub writer configured: ${writer.repo}@${writer.branch || 'main'}`)
        parts.push(`     Writes commit directly to GitHub via API`)
      } else if (writer && writer.isConfigured === false) {
        parts.push(`  ⚠️  GitHub writer NOT configured (missing GITHUB_TOKEN or GITHUB_REPO)`)
        parts.push(`     Writes will return setup instructions, not actually commit`)
      } else {
        parts.push(`  ✅ Local filesystem writer`)
        parts.push(`     Writes go to disk at ${scope.rootDirs[0] || process.cwd()}`)
      }
      
      if (reader && reader.repo) {
        parts.push(`  ✅ GitHub reader configured: ${reader.repo}@${reader.branch || 'main'}`)
        parts.push(`     Reads fetch from GitHub API (serverless environment)`)
      } else {
        parts.push(`  ✅ Local filesystem reader`)
        parts.push(`     Reads from disk at ${scope.rootDirs[0] || process.cwd()}`)
      }
      parts.push('')
      
      // Scope
      parts.push('**Scope**:')
      parts.push(`  Root directories: ${scope.rootDirs.join(', ')}`)
      parts.push(`  Excluded paths: ${scope.excludePaths.length > 0 ? scope.excludePaths.map(p => path.basename(p)).join(', ') : 'none'}`)
      parts.push(`  Max file size: ${Math.round(scope.maxFileBytes / 1024)} KB`)
      parts.push(`  Command timeout: ${scope.execTimeoutMs / 1000}s`)
      parts.push('')
      
      // Environment
      parts.push('**Environment**:')
      const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME
      parts.push(`  Runtime: ${isServerless ? 'serverless (Vercel/Lambda)' : 'persistent (local/VM)'}`)
      parts.push(`  Node version: ${process.version}`)
      parts.push(`  Platform: ${process.platform}`)
      parts.push('')
      
      // Capabilities
      parts.push('**Capabilities**:')
      parts.push(`  ✅ read_file — read source files`)
      parts.push(`  ${writer ? '✅' : '❌'} write_file — create/overwrite files`)
      parts.push(`  ${writer ? '✅' : '❌'} edit_file — surgical edits`)
      parts.push(`  ${writer ? '✅' : '❌'} delete_file — remove files`)
      parts.push(`  ✅ search_files — grep for patterns`)
      parts.push(`  ✅ list_files — find files by name`)
      parts.push(`  ✅ run_command — execute shell commands`)
      parts.push(`  ${process.env.TAVILY_API_KEY ? '✅' : '⚠️ '} web_search — live web search ${process.env.TAVILY_API_KEY ? '' : '(TAVILY_API_KEY not set)'}`)
      parts.push(`  ✅ core_system_reference — query self-knowledge`)
      parts.push(`  ✅ self_diagnostic — this tool`)
      parts.push('')
      
      // Common issues
      parts.push('**Common Issues**:')
      if (!writer || writer.isConfigured === false) {
        parts.push(`  ⚠️  Writes are disabled. If you need to commit changes, ask the user to set GITHUB_TOKEN and GITHUB_REPO env vars.`)
      }
      if (!process.env.TAVILY_API_KEY) {
        parts.push(`  ⚠️  web_search is unavailable (TAVILY_API_KEY not set). You cannot verify 3rd-party UI layouts.`)
      }
      if (scope.rootDirs.length === 0) {
        parts.push(`  ⚠️  No root directories configured. File operations will fail.`)
      }
      if (parts.filter(p => p.includes('⚠️')).length === 0) {
        parts.push(`  ✅ No issues detected. All systems operational.`)
      }
      parts.push('')
      
      parts.push('**Next Steps**:')
      parts.push(`  • If writes are failing, check the "File I/O Mode" section above`)
      parts.push(`  • If you cannot find a file, use list_files or search_files`)
      parts.push(`  • If you need to know where something lives, call core_system_reference`)
      parts.push(`  • If you are unsure what to do, check OPERATIONAL_PATTERNS in your system prompt`)
      
      return parts.join('\n')
    },
  }
}

/**
 * Core System quick reference tool — callable knowledge base.
 * When the agent needs to know "how do I add an API endpoint?" or
 * "where is the auth code?", it can call this instead of searching.
 */
export function coreSystemReferenceTool() {
  return {
    name: 'core_system_reference',
    description: 'Look up Auroraly architecture facts, operational patterns, or failure modes. Use this when you need to know WHERE a file lives or HOW to do a common task. Faster than searching.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What you want to know. Examples: "where is auth code", "how to add API endpoint", "failure modes for auth", "where is agent core"',
        },
      },
      required: ['query'],
    },
    async execute({ query }) {
      const lower = query.toLowerCase()
      const parts = []

      // Match architecture categories
      if (lower.includes('auth') || lower.includes('login') || lower.includes('permission')) {
        parts.push('## AUTH & PERMISSIONS')
        for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.auth)) {
          parts.push(`  • \`${path}\` — ${desc}`)
        }
        parts.push('')
      }

      if (lower.includes('agent') || lower.includes('tool') || lower.includes('prompt') || lower.includes('core')) {
        parts.push('## AGENT CORE (what you ARE)')
        for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.agentCore)) {
          parts.push(`  • \`${path}\` — ${desc}`)
        }
        parts.push('')
      }

      if (lower.includes('chat') || lower.includes('message') || lower.includes('stream')) {
        parts.push('## CHAT SYSTEM')
        for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.chatSystem)) {
          parts.push(`  • \`${path}\` — ${desc}`)
        }
        parts.push('')
      }

      if (lower.includes('file') || lower.includes('read') || lower.includes('write') || lower.includes('github')) {
        parts.push('## FILE I/O')
        for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.fileSystem)) {
          parts.push(`  • \`${path}\` — ${desc}`)
        }
        parts.push('')
      }

      if (lower.includes('database') || lower.includes('supabase') || lower.includes('schema') || lower.includes('migration')) {
        parts.push('## DATABASE')
        for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.database)) {
          parts.push(`  • \`${path}\` — ${desc}`)
        }
        parts.push('')
      }

      if (lower.includes('credit') || lower.includes('stripe') || lower.includes('payment') || lower.includes('billing')) {
        parts.push('## CREDITS & BILLING')
        for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.credits)) {
          parts.push(`  • \`${path}\` — ${desc}`)
        }
        parts.push('')
      }

      if (lower.includes('preview') || lower.includes('fly') || lower.includes('runner')) {
        parts.push('## PREVIEW SYSTEM')
        for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.preview)) {
          parts.push(`  • \`${path}\` — ${desc}`)
        }
        parts.push('')
      }

      if (lower.includes('protected') || lower.includes('guard') || lower.includes('confirmed')) {
        parts.push('## PROTECTED PATHS (require CONFIRMED: token)')
        for (const [pattern, desc] of Object.entries(CORE_ARCHITECTURE.protected)) {
          parts.push(`  • \`${pattern}\` — ${desc}`)
        }
        parts.push('')
      }

      // Match operational patterns
      if (lower.includes('how') || lower.includes('add') || lower.includes('fix') || lower.includes('update') || lower.includes('pattern')) {
        parts.push('## OPERATIONAL PATTERNS — HOW TO DO COMMON TASKS')
        parts.push('')
        for (const [task, pattern] of Object.entries(OPERATIONAL_PATTERNS)) {
          if (lower.includes(task.toLowerCase().split(' ').slice(0, 3).join(' '))) {
            parts.push(`**${task}**:`)
            for (const step of pattern.steps) {
              parts.push(`  ${step}`)
            }
            parts.push(`  Files: ${pattern.files.join(', ')}`)
            parts.push('')
          }
        }
      }

      // Match failure modes
      if (lower.includes('failure') || lower.includes('incident') || lower.includes('wrong') || lower.includes('mistake') || lower.includes('avoid')) {
        parts.push('## FAILURE MODES — WHAT NOT TO DO')
        parts.push('')
        for (const [title, incident] of Object.entries(FAILURE_MODES)) {
          parts.push(`**${title}**:`)
          if (incident.symptom) parts.push(`  Symptom: ${incident.symptom}`)
          if (incident.wrongApproach) parts.push(`  ❌ Wrong: ${incident.wrongApproach}`)
          if (incident.correctApproach) parts.push(`  ✅ Correct: ${incident.correctApproach}`)
          if (incident.lesson) parts.push(`  **Lesson**: ${incident.lesson}`)
          parts.push('')
        }
      }

      if (parts.length === 0) {
        return [
          `No exact match for "${query}".`,
          '',
          'Available categories: auth, agent, chat, file, database, credits, preview, protected, patterns, failure modes.',
          '',
          'Try a more specific query like "where is auth code" or "how to add API endpoint".',
        ].join('\n')
      }

      return parts.join('\n')
    },
  }
}

/**
 * Convenience: returns the full default tool set bound to a scope.
 * Optionally pass:
 *   - writer (e.g. from buildGithubWriter): routes write_file / edit_file
 *     through a remote writer instead of fs.
 *   - reader (e.g. from buildGithubReader): routes read_file / search_files /
 *     list_files through a remote reader. Required on serverless where the
 *     deployed bundle does NOT contain the source tree.
 */
export function buildDefaultToolset(rawScope, writer = null, reader = null, attachments = null, guardCtx = null) {
  const tools = [
    readFileTool(rawScope, reader),
    writeFileTool(rawScope, writer, guardCtx),
    editFileTool(rawScope, writer, guardCtx),
    deleteFileTool(rawScope, writer),
    runCommandTool(rawScope),
    searchFilesTool(rawScope, reader),
    listFilesTool(rawScope, reader),
    // web_search: live web access via Tavily. Available to every chat
    // (project + self-edit) so the model can verify 3rd-party UI/API
    // layouts that may have changed since its training data. The
    // tool itself handles the missing-key case gracefully — if
    // TAVILY_API_KEY is unset it returns a clear instruction rather
    // than throwing, so chats still work without web search.
    webSearchTool(),
  ]
  
  // Core System quick reference — only in self-edit mode
  if (guardCtx?.isSelfEdit) {
    tools.push(coreSystemReferenceTool())
  }
  // Only expose save_attachment when the current turn actually carries
  // attachments — otherwise it just bloats the tool list and tempts the
  // model to hallucinate an attachment that doesn't exist.
  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    tools.push(saveAttachmentTool(rawScope, writer, attachments))
    // Expose the structural anti-fabrication gate. The stream handler
    // pairs this with forceFirstToolCall when at least one attachment
    // is an image, so the model is required to call it before answering.
    const hasImage = attachments.some((a) =>
      a?.file_category === 'image' ||
      a?.type?.startsWith('image/') ||
      a?.mime_type?.startsWith('image/'),
    )
    if (hasImage) {
      tools.push(submitScreenshotInventoryTool(attachments))
    }
  }
  return tools
}

/**
 * save_attachment_to_path — Save an image / PDF / binary attachment that
 * the user uploaded with the CURRENT message into the project file tree
 * at a given path. Solves the "write_file only accepts strings, so I
 * cannot save the actual binary data" failure mode where the agent
 * inventories an image correctly but then writes a 28-byte stub.
 *
 * How it works:
 *   • Attachments arrive as base64 data URLs (`data:image/png;base64,…`)
 *     in metadata.attachments[].preview_data (images) or .data (pdf).
 *   • This tool finds the attachment by 1-based index OR exact filename,
 *     then upserts the data URL string straight into project_files via
 *     the project writer.
 *   • The Fly preview runner already decodes `data:<mime>;base64,<…>`
 *     URIs back to binary during file sync (preview-runner/index.js
 *     line 504), so the file lands on disk as the real PNG / PDF and
 *     Vite serves it the next time the iframe reloads.
 *
 * The model never has to base64-encode anything itself — it just picks
 * an attachment by index/filename and a destination path.
 */
export function saveAttachmentTool(rawScope, writer, attachments) {
  const scope = normalizeScope(rawScope)
  const summary = (attachments || [])
    .map((a, i) => {
      const kind = a.file_category || a.category || 'binary'
      const size = a.size ? ` ${Math.round(a.size / 1024)}KB` : ''
      return `${i + 1}. "${a.filename}" (${kind}${size})`
    })
    .join('\n  ')
  return {
    name: 'save_attachment_to_path',
    description:
      `Save one of the user's CURRENT-MESSAGE attachments to a project file path. ` +
      `Use this — NOT write_file — for any image, PDF, or other binary the user uploaded. ` +
      `write_file only accepts text and silently truncates binaries to a few bytes. ` +
      `Attachments available on this turn:\n  ${summary || '(none)'}`,
    input_schema: {
      type: 'object',
      properties: {
        attachment_index: {
          type: 'integer',
          description: '1-based index of the attachment to save (1, 2, 3, …). Optional if attachment_filename is provided.',
        },
        attachment_filename: {
          type: 'string',
          description: 'Exact filename of the attachment as shown in the inventory (e.g. "logo.png"). Optional if attachment_index is provided.',
        },
        path: {
          type: 'string',
          description: 'Project-relative destination path (e.g. "frontend/public/assets/mangia-mama/ui/logo.png").',
        },
      },
      required: ['path'],
    },
    async execute({ attachment_index, attachment_filename, path: reqPath }) {
      if (!writer || !writer.writeFile) {
        throw new Error('save_attachment_to_path requires a project writer; this scope is read-only')
      }
      if (!attachments || attachments.length === 0) {
        throw new Error('No attachments on the current message. The user must drag-and-drop a file before this tool can be called.')
      }
      let att = null
      if (Number.isInteger(attachment_index) && attachment_index >= 1 && attachment_index <= attachments.length) {
        att = attachments[attachment_index - 1]
      } else if (typeof attachment_filename === 'string' && attachment_filename.trim()) {
        att = attachments.find((a) => a.filename === attachment_filename) || null
      }
      if (!att) {
        const opts = attachments.map((a, i) => `${i + 1}: "${a.filename}"`).join(', ')
        throw new Error(`Attachment not found. Available: ${opts}. Pass attachment_index (1-based) or attachment_filename.`)
      }
      const dataUrl = att.preview_data || att.data
      if (!dataUrl || typeof dataUrl !== 'string') {
        throw new Error(`Attachment "${att.filename}" has no binary data on this turn (file_category=${att.file_category}). Cannot save binary.`)
      }
      // Light validation: ensure path is in scope (writer may also enforce this).
      resolveInScope(scope, reqPath)
      const repoPath = toRepoPath(scope, reqPath)
      // Writer stores the full data URL as the file's "content". The Fly
      // preview runner detects the `data:…;base64,…` prefix during sync
      // and decodes it back to a binary buffer before fs.writeFileSync.
      await writer.writeFile(repoPath, dataUrl, `Save attachment "${att.filename}" to ${reqPath}`)
      // Roughly approximate the on-disk byte size so the agent's status
      // message tells the truth ("Saved 412.3KB to …" not "Wrote 562KB
      // of base64 string"). Base64 expands binary by ~4/3.
      const base64Body = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
      const onDiskBytes = Math.floor((base64Body.length * 3) / 4)
      const kb = onDiskBytes >= 1024 ? `${(onDiskBytes / 1024).toFixed(1)} KB` : `${onDiskBytes} B`
      return `Saved attachment "${att.filename}" (${kb}) to ${reqPath}. The Fly preview runner will decode the base64 on next sync and Vite will serve the binary directly. No need to call write_file with the data — it's already on its way.`
    },
  }
}


/**
 * submit_screenshot_inventory — STRUCTURAL ANTI-FABRICATION GATE.
 *
 * When the user's current turn carries one or more screenshots, the
 * agent loop is configured to FORCE the model's first response to be
 * a call to this tool (via Anthropic's tool_choice mechanism). The
 * model literally cannot emit prose until it has filled out the
 * structured inventory fields below.
 *
 * Why this exists: previous attempts to enforce screenshot inventory
 * via system-prompt instructions failed. The model's own confession:
 * "I desperately wanted my fix to work … I projected my desired
 * outcome onto the screenshot instead of objectively describing it."
 * Instructions can be rationalized away. A required tool call cannot.
 *
 * Schema design notes:
 *   • `visible_elements`, `text_quotes`, `cropped_or_hidden` are
 *     arrays of LITERAL observations — fields named for what the
 *     model must look at, not for what conclusion to draw.
 *   • `comparison_to_user_expectation` forces the model to actually
 *     compare its observations to what the user said should be there.
 *     If the user has not yet stated an expectation, the model must
 *     say so explicitly — fabricating a phantom expectation is also
 *     blocked by the schema (the field requires a literal string).
 *   • `verdict` is an enum of two values. There is no "looks good
 *     to me" option without specifying which inventory items prove
 *     it. The tool's return string echoes the verdict back and
 *     forbids positive language when verdict === 'problems_present'.
 *   • `forbidden_positive_phrases_acknowledged` is a tripwire bool —
 *     the model must explicitly tick this acknowledgement, which
 *     forces it to read the rule before answering.
 */
export function submitScreenshotInventoryTool(attachments) {
  const attachmentList = (attachments || [])
    .map((a, i) => `${i + 1}. "${a.filename}"`)
    .join('\n  ')
  return {
    name: 'submit_screenshot_inventory',
    description: [
      'MANDATORY before any other response when the current user turn has screenshot attachments.',
      'Produce a literal, neutral inventory of EVERY screenshot attached this turn. Do not infer, do not interpret, do not assess. Just describe what is in the pixels.',
      '',
      'Attached this turn:',
      '  ' + attachmentList,
      '',
      'This tool MUST be called once and only once, before you produce any prose response. After the tool returns, you may answer the user — but only using facts grounded in this inventory.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      required: [
        'inventory_per_image',
        'comparison_to_user_expectation',
        'layout_notes',
        'verdict',
        'forbidden_positive_phrases_acknowledged',
      ],
      additionalProperties: false,
      properties: {
        inventory_per_image: {
          type: 'array',
          description: 'One entry per attached screenshot, in attachment order.',
          minItems: 1,
          items: {
            type: 'object',
            required: ['attachment_label', 'visible_elements', 'text_quotes', 'cropped_or_hidden', 'colors_and_states'],
            additionalProperties: false,
            properties: {
              attachment_label: {
                type: 'string',
                description: 'e.g. "attachment 1: bug-report.png"',
              },
              visible_elements: {
                type: 'array',
                description: 'Literal description of each visible UI element, one per array item. e.g. ["A modal dialog positioned flush with the top of the viewport (y=0)", "A primary button labelled \'Save\' partially hidden behind the system dock"]. Never include a conclusion ("looks centered") — only observations ("positioned at y=0").',
                items: { type: 'string' },
                minItems: 1,
              },
              text_quotes: {
                type: 'array',
                description: 'Exact text quoted from the image, including any partial / cut-off text. e.g. ["User Manag" (cut off at top edge), "Cancel", "Save"]. Empty array only if no text is visible at all.',
                items: { type: 'string' },
              },
              cropped_or_hidden: {
                type: 'array',
                description: 'Each item is one thing that is cropped, cut off, partially visible, hidden behind another element, or off-screen. e.g. ["Top of modal header is cut off — only \'User Manag\' is visible, rest is above viewport"]. Empty array only if NOTHING is cropped or partially obscured.',
                items: { type: 'string' },
              },
              colors_and_states: {
                type: 'array',
                description: 'Notable colors, focus states, hover/active/disabled states, error highlights, etc. e.g. ["Modal backdrop is solid black, no transparency", "Save button is enabled (blue, not greyed out)"]',
                items: { type: 'string' },
              },
            },
          },
        },
        comparison_to_user_expectation: {
          type: 'object',
          required: ['user_stated_expectation', 'matches', 'mismatches'],
          additionalProperties: false,
          description: 'Compare inventory to what the user said should be there. If the user has not stated an expectation yet, set user_stated_expectation to "user has not stated an expectation on this turn" and leave matches/mismatches empty.',
          properties: {
            user_stated_expectation: {
              type: 'string',
              description: 'Literal quote or close paraphrase of what the user said should be visible. Do not invent an expectation the user did not state.',
            },
            matches: {
              type: 'array',
              description: 'Items where the inventory matches the user expectation. e.g. ["User said modal should appear → modal IS visible in inventory"].',
              items: { type: 'string' },
            },
            mismatches: {
              type: 'array',
              description: 'Items where the inventory contradicts the user expectation. e.g. ["User said modal should be centered → inventory shows modal at y=0, flush with top → MISMATCH"]. CRITICAL: anything cropped, cut off, missing, or misaligned that the user expected to be normal goes here.',
              items: { type: 'string' },
            },
          },
        },
        layout_notes: {
          type: 'string',
          description: 'One-paragraph snapshot of key layout facts that will be referenced on the NEXT screenshot turn to track changes. Keep under 300 chars. e.g. "Modal y=0, header cropped at top edge, Save button hidden by dock at y=820. Backdrop fills viewport. No visible centering."',
        },
        verdict: {
          type: 'string',
          enum: ['problems_present', 'no_problems_visible'],
          description: 'problems_present iff cropped_or_hidden is non-empty OR mismatches is non-empty OR any error text is visible. no_problems_visible ONLY if every inventory_per_image entry has empty cropped_or_hidden AND mismatches is empty AND no error text exists.',
        },
        forbidden_positive_phrases_acknowledged: {
          type: 'boolean',
          description: 'Set to true to acknowledge: "If verdict is problems_present, I am FORBIDDEN from saying \'looks perfect\', \'looks good\', \'that\'s fixed\', \'it\'s working now\', \'the fix worked\', or any equivalent positive assessment in my response. I must instead state the specific problems from the inventory."',
        },
      },
    },
    async execute(args) {
      const verdict = args?.verdict
      const ack = args?.forbidden_positive_phrases_acknowledged === true
      const mismatches = args?.comparison_to_user_expectation?.mismatches || []
      const inventory = args?.inventory_per_image || []
      const cropped = inventory.flatMap((img) => img?.cropped_or_hidden || [])

      // ── Anti-fabrication validator (added 2026-05-24) ──────────────
      // User report: even with the gate forcing a tool call, the model
      // was still inventing "App information section", "Test users
      // section", "Developer contact information section" etc. on
      // screenshots that contained NONE of those literal phrases.
      // Fix: cross-reference visible_elements claims against text_quotes.
      // If the model claims to see a labelled section/page/heading but
      // never quotes any text remotely matching that label, the
      // claim is fabricated. Reject the inventory and demand a retry.
      //
      // Heuristic: extract proper-noun-ish words (capitalized, ≥4
      // chars, not common English) from each visible_elements entry.
      // For each such word, require it (case-insensitive) to appear
      // in SOME text_quotes entry for the same image. If a word
      // appears in no quotes, it's evidence of fabrication.
      const STOPWORDS = new Set([
        'page', 'section', 'screen', 'view', 'modal', 'panel', 'tab',
        'button', 'link', 'menu', 'sidebar', 'header', 'footer', 'icon',
        'field', 'item', 'list', 'card', 'row', 'column', 'overview',
        'metrics', 'dashboard', 'settings', 'home', 'main', 'top',
        'bottom', 'left', 'right', 'center', 'middle', 'with', 'and',
        'the', 'this', 'that', 'these', 'those', 'shown', 'visible',
        'shows', 'displayed', 'enabled', 'disabled', 'active', 'selected',
        'data', 'available', 'project', 'image', 'screenshot', 'click',
        'clicked', 'hover', 'state', 'states', 'highlighted', 'background',
        'color', 'colors', 'text', 'label', 'labels', 'title', 'titles',
        'name', 'names', 'window', 'tabs', 'sidebars', 'headers', 'footers',
      ])
      const fabricationEvidence = []
      for (const img of inventory) {
        const quotedTextLower = (img?.text_quotes || []).join(' ').toLowerCase()
        const elements = img?.visible_elements || []
        for (const el of elements) {
          if (typeof el !== 'string') continue

          // Layer 1: Extract capitalized proper-noun-like labels and
          // require each to appear in text_quotes (case-insensitive).
          const claimedLabels = (el.match(/\b[A-Z][a-zA-Z]{3,}\b/g) || [])
            .filter((w) => !STOPWORDS.has(w.toLowerCase()))
          for (const label of claimedLabels) {
            if (!quotedTextLower.includes(label.toLowerCase())) {
              fabricationEvidence.push({
                attachment: img?.attachment_label || 'unlabeled',
                claimed_label: label,
                in_element: el.slice(0, 100),
                reason: 'capitalized label not in text_quotes',
              })
            }
          }

          // Layer 2 (added 2026-05-28): Extract any text in single or
          // double quotes within visible_elements. The model uses
          // quotes when CITING literal on-screen text, and those
          // citations MUST appear in text_quotes. This catches the
          // common-word fabrication pattern (e.g. 'User already
          // registered' — none of those words trigger the capitalized
          // proper-noun check because 'user' is a stopword and
          // 'already', 'registered' are lowercase).
          const quotedCitations = [
            ...(el.match(/'([^']{3,80})'/g) || []),
            ...(el.match(/"([^"]{3,80})"/g) || []),
          ].map((q) => q.replace(/^['"]|['"]$/g, '').trim())
          for (const cite of quotedCitations) {
            if (cite.length < 3) continue
            // Allow short generic citations like 'OK', 'Cancel' to pass
            // since the model may quote generic UI text. Require ≥3
            // distinguishing chars and check case-insensitively.
            if (!quotedTextLower.includes(cite.toLowerCase())) {
              fabricationEvidence.push({
                attachment: img?.attachment_label || 'unlabeled',
                claimed_label: `"${cite}"`,
                in_element: el.slice(0, 100),
                reason: 'quoted on-screen text not in text_quotes',
              })
            }
          }
        }
      }

      if (fabricationEvidence.length > 0) {
        const lines = fabricationEvidence.slice(0, 5).map(
          (e) => `  • Claimed "${e.claimed_label}" in [${e.attachment}] (element: "${e.in_element}…") but no text_quotes entry contains "${e.claimed_label}".`,
        )
        return [
          'INVENTORY REJECTED — possible fabrication detected.',
          '',
          'Your inventory claims to see labels/sections that are not in your own text_quotes:',
          ...lines,
          fabricationEvidence.length > 5 ? `  …and ${fabricationEvidence.length - 5} more.` : '',
          '',
          'This is the failure mode the user reported: claiming sections like "App information", "Test users", "Developer contact information" exist when the screenshot does not contain those exact phrases.',
          '',
          'Resubmit submit_screenshot_inventory. For each visible_elements entry that names a label, that label MUST appear verbatim in some text_quotes entry for the same image. If you cannot find the label in the actual pixels, do not claim to see it — describe only what you can quote. If the image is unclear or shows nothing you can quote, say so explicitly: visible_elements may contain "Page appears mostly blank, no clear section headings visible" but must not invent labels.',
        ].filter(Boolean).join('\n')
      }
      // ─────────────────────────────────────────────────────────────────

      // Schema guard: the model could in theory submit verdict=no_problems_visible
      // while cropped/mismatches are non-empty. Catch that contradiction and
      // reject the inventory with a clear instruction so the model retries.
      if (verdict === 'no_problems_visible' && (cropped.length > 0 || mismatches.length > 0)) {
        return [
          'INVENTORY REJECTED — internal contradiction.',
          `You set verdict="no_problems_visible" but your own inventory lists ${cropped.length} cropped/hidden items and ${mismatches.length} mismatches.`,
          'Re-submit submit_screenshot_inventory with verdict="problems_present" OR remove the items from cropped_or_hidden / mismatches if they are not actually problems.',
          'Do not fabricate a clean verdict over a dirty inventory.',
        ].join('\n')
      }

      if (!ack) {
        return [
          'INVENTORY REJECTED — acknowledgement missing.',
          'forbidden_positive_phrases_acknowledged must be true. Re-submit with that field set so you explicitly accept the prohibition before answering the user.',
        ].join('\n')
      }

      const verdictLine = verdict === 'problems_present'
        ? `VERDICT: problems_present. You are FORBIDDEN from saying "looks perfect", "looks good", "that's fixed", "it's working now", "the fix worked", or any equivalent positive assessment in your next response. State the specific problems from the inventory. The user dropped this screenshot precisely to surface those problems.`
        : `VERDICT: no_problems_visible. You may state success, but each success claim must cite a specific inventory item as evidence (e.g. "Modal header reads 'User Management' fully visible at y=120 — matches user's expected centered layout").`

      return [
        'Inventory recorded.',
        verdictLine,
        '',
        'Now respond to the user. Reference your inventory items directly. Do not introduce new visual claims that are not in the inventory you just submitted — that would be fabrication.',
      ].join('\n')
    },
  }
}
