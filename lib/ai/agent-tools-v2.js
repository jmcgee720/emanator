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
      ? `Read a file from ${reader.repo}@${reader.branch} via GitHub. Returns content with line numbers prepended. Use BEFORE editing a file. The full file content is AUTOMATICALLY displayed to the user inline when you call this tool — you do NOT need to paste it again in your response. Just answer the user's question about the file (e.g. "yes, tailwindcss is missing from devDependencies" or "the import on line 12 is causing the crash"). If the user only asked to see it with no follow-up question, a one-sentence acknowledgement is fine.`
      : 'Read the contents of a file. Returns content with line numbers prepended. Use this BEFORE editing a file. The full file content is AUTOMATICALLY displayed to the user inline when you call this tool — you do NOT need to paste it again in your response. Just answer the user\'s question about the file (e.g. "yes, tailwindcss is missing from devDependencies" or "the import on line 12 is causing the crash"). If the user only asked to see it with no follow-up question, a one-sentence acknowledgement is fine.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or root-relative path to the file' },
      },
      required: ['path'],
    },
    async execute({ path: reqPath }) {
      if (reader) {
        // Use the repo path (strip any scope-root prefix) so the GitHub
        // API request matches the actual source layout.
        const repoPath = toRepoPath(scope, reqPath)
        const { content, lineCount, source } = await reader.readFile(repoPath, scope.maxFileBytes)
        return `${source} (${lineCount} lines)\n\n\`\`\`\n${addLineNumbers(content)}\n\`\`\``
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
      return `${abs} (${lineCount} lines)\n\n\`\`\`\n${addLineNumbers(content)}\n\`\`\``
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
  ]
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
      const cropped = (args?.inventory_per_image || []).flatMap((img) => img?.cropped_or_hidden || [])

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
