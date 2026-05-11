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

/* ───────────────────────────── tools ───────────────────────────────── */

export function readFileTool(rawScope) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'read_file',
    description:
      'Read the contents of a file. Returns content with line numbers prepended. Use this BEFORE editing a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or root-relative path to the file' },
      },
      required: ['path'],
    },
    async execute({ path: reqPath }) {
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

export function writeFileTool(rawScope) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'write_file',
    description:
      'Write a NEW file or COMPLETELY overwrite an existing one. For surgical edits to existing files, use edit_file instead.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or root-relative path' },
        content: { type: 'string', description: 'Full file content' },
      },
      required: ['path', 'content'],
    },
    async execute({ path: reqPath, content }) {
      const abs = resolveInScope(scope, reqPath)
      if (typeof content !== 'string') throw new Error('content must be a string')
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content, 'utf-8')
      return `Wrote ${abs} (${content.length} bytes)`
    },
  }
}

export function editFileTool(rawScope) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'edit_file',
    description:
      'Replace EXACT text in an existing file. old_str must appear exactly once. For multiple edits, call this tool multiple times.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_str: { type: 'string', description: 'Exact existing text to replace (must be unique in the file)' },
        new_str: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
    async execute({ path: reqPath, old_str, new_str }) {
      const abs = resolveInScope(scope, reqPath)
      if (!fs.existsSync(abs)) throw new Error(`"${reqPath}" does not exist`)
      const raw = fs.readFileSync(abs, 'utf-8')
      if (typeof old_str !== 'string' || old_str.length === 0) {
        throw new Error('old_str must be a non-empty string')
      }
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
      'Execute a shell command. Use this to find files, grep, list directories, or anything else the other tools do not cover. Output is truncated to 10 KB.',
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
        // Surface exit code, stderr, and stdout — the model needs to see real failure
        const stdout = err.stdout || ''
        const stderr = err.stderr || ''
        const code = err.code != null ? err.code : 'unknown'
        return `[command failed: exit ${code}]\nstdout:\n${stdout}\nstderr:\n${stderr}`.slice(0, 10_000)
      }
    },
  }
}

export function searchFilesTool(rawScope) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'search_files',
    description:
      'Search file contents recursively for a pattern (grep). Returns matching file paths with line numbers.',
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
      const base = searchPath ? resolveInScope(scope, searchPath) : scope.rootDirs[0]
      const exclArgs = scope.excludePaths
        .map((ex) => `--exclude-dir=${path.basename(ex)}`)
        .join(' ')
      // -r recursive, -n line numbers, -l filename, -I skip binary, -E extended regex
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

export function listFilesTool(rawScope) {
  const scope = normalizeScope(rawScope)
  return {
    name: 'list_files',
    description:
      'List files matching a name pattern (find -name). Useful for locating a file when you do not know the exact path.',
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
 */
export function buildDefaultToolset(rawScope) {
  return [
    readFileTool(rawScope),
    writeFileTool(rawScope),
    editFileTool(rawScope),
    runCommandTool(rawScope),
    searchFilesTool(rawScope),
    listFilesTool(rawScope),
  ]
}
