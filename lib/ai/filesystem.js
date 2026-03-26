/**
 * Filesystem Awareness Module — Full Implementation
 *
 * Parts covered:
 *   1. Project File Tree Index with caching
 *   2. Intent-aware context selection
 *   3. File relationship graph (imports/exports/component usage)
 *   4. Safe multi-file editing validation
 *   5. Search helpers (by name, import, similarity)
 */

import { db } from '@/lib/supabase/db'

// ─── In-memory cache keyed by projectId ─────────────────────────────

const _cache = new Map()          // projectId → { tree, graph, ts }
const CACHE_TTL_MS = 60_000       // 60 s

function getCached(projectId) {
  const entry = _cache.get(projectId)
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry
  return null
}

function setCache(projectId, data) {
  _cache.set(projectId, { ...data, ts: Date.now() })
}

export function invalidateCache(projectId) {
  _cache.delete(projectId)
}

// ─── Part 1 — File Tree Index ────────────────────────────────────────

/**
 * Build (or return cached) structured file tree for a project.
 * Each node: { path, filename, extension, imports, exports, componentName, size, id, version }
 */
export async function getProjectTree(projectId) {
  const cached = getCached(projectId)
  if (cached) return cached.tree

  const files = await db.projectFiles.findByProjectId(projectId)
  if (!files?.length) return []

  const tree = files.map(f => buildFileNode(f))
  const graph = buildRelationshipGraph(tree)
  setCache(projectId, { tree, graph })
  return tree
}

function buildFileNode(file) {
  const parts = file.path.split('/')
  const filename = parts[parts.length - 1]
  const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : ''
  const content = file.content || ''

  return {
    id: file.id,
    path: file.path,
    filename,
    extension,
    version: file.version || 1,
    size: content.length,
    imports: extractImports(content),
    exports: extractExports(content),
    componentName: extractComponentName(content, filename),
  }
}

// ─── Import / Export extraction ──────────────────────────────────────

const IMPORT_RE = /(?:import\s+(?:\{[^}]*\}|[^'";\n]*)\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g
const EXPORT_DEFAULT_RE = /export\s+default\s+(?:function|class|const|let|var)?\s*(\w+)/g
const EXPORT_NAMED_RE = /export\s+(?:function|class|const|let|var)\s+(\w+)/g

function extractImports(content) {
  if (!content) return []
  const found = []
  let m
  const re = new RegExp(IMPORT_RE.source, 'g')
  while ((m = re.exec(content)) !== null) {
    found.push(m[1] || m[2])
  }
  return [...new Set(found)]
}

function extractExports(content) {
  if (!content) return []
  const found = []
  let m
  let re = new RegExp(EXPORT_DEFAULT_RE.source, 'g')
  while ((m = re.exec(content)) !== null) found.push(m[1])
  re = new RegExp(EXPORT_NAMED_RE.source, 'g')
  while ((m = re.exec(content)) !== null) found.push(m[1])
  return [...new Set(found)]
}

function extractComponentName(content, filename) {
  if (!content) return null
  // Try export default function/class name
  const defMatch = content.match(/export\s+default\s+(?:function|class)\s+(\w+)/)
  if (defMatch) return defMatch[1]
  // Try const X = () => or function X(
  const fnMatch = content.match(/(?:const|function)\s+([A-Z]\w+)\s*(?:=\s*(?:\([^)]*\)\s*=>|\()|[({])/)
  if (fnMatch) return fnMatch[1]
  // Fall back to PascalCase of filename (without extension)
  const base = filename.replace(/\.[^.]+$/, '')
  if (/^[A-Z]/.test(base)) return base
  return null
}

// ─── Part 5 — File Relationship Graph ────────────────────────────────

/**
 * Build a directed graph of file relationships.
 * Returns: Map<path, { imports: string[], importedBy: string[], exports: string[], componentName: string|null }>
 */
function buildRelationshipGraph(tree) {
  const graph = new Map()

  // Initialize nodes
  for (const node of tree) {
    graph.set(node.path, {
      imports: [],
      importedBy: [],
      exports: node.exports,
      componentName: node.componentName,
    })
  }

  // Resolve import paths to actual project files
  const pathSet = new Set(tree.map(n => n.path))
  const pathWithoutExt = new Map()
  for (const p of pathSet) {
    const base = p.replace(/\.[^.]+$/, '')
    pathWithoutExt.set(base, p)
    // Also store just the filename without extension
    const parts = base.split('/')
    pathWithoutExt.set(parts[parts.length - 1], p)
  }

  for (const node of tree) {
    const entry = graph.get(node.path)
    for (const imp of node.imports) {
      // Try to resolve the import to a project file
      const resolved = resolveImport(imp, node.path, pathSet, pathWithoutExt)
      if (resolved) {
        entry.imports.push(resolved)
        const target = graph.get(resolved)
        if (target) target.importedBy.push(node.path)
      }
    }
  }

  return graph
}

function resolveImport(importPath, fromPath, pathSet, pathWithoutExt) {
  // Skip node_modules / external packages
  if (!importPath.startsWith('.') && !importPath.startsWith('/') && !importPath.startsWith('@/')) {
    return null
  }

  // Normalize relative paths
  let candidate = importPath
  if (importPath.startsWith('.')) {
    const fromDir = fromPath.split('/').slice(0, -1).join('/')
    const parts = importPath.split('/')
    const resolved = []
    for (const p of [...fromDir.split('/').filter(Boolean), ...parts]) {
      if (p === '..') resolved.pop()
      else if (p !== '.') resolved.push(p)
    }
    candidate = resolved.join('/')
  } else if (importPath.startsWith('@/')) {
    candidate = importPath.slice(2)
  }

  // Direct match
  if (pathSet.has(candidate)) return candidate

  // Try with extensions
  for (const ext of ['', '.js', '.jsx', '.ts', '.tsx', '.json', '.css']) {
    if (pathSet.has(candidate + ext)) return candidate + ext
  }
  // Try index files
  for (const idx of ['/index.js', '/index.jsx', '/index.ts', '/index.tsx']) {
    if (pathSet.has(candidate + idx)) return candidate + idx
  }

  // Try without extension match
  const base = candidate.replace(/\.[^.]+$/, '')
  if (pathWithoutExt.has(base)) return pathWithoutExt.get(base)

  return null
}

/**
 * Get the relationship graph for a project (cached).
 */
export async function getFileGraph(projectId) {
  const cached = getCached(projectId)
  if (cached) return cached.graph
  // Build tree first (which also builds graph)
  await getProjectTree(projectId)
  return getCached(projectId)?.graph || new Map()
}

/**
 * Get all files that import a given file (impact analysis for refactoring).
 */
export async function getImporters(projectId, filePath) {
  const graph = await getFileGraph(projectId)
  const entry = graph.get(filePath)
  return entry?.importedBy || []
}

/**
 * Get all files that a given file imports.
 */
export async function getDependencies(projectId, filePath) {
  const graph = await getFileGraph(projectId)
  const entry = graph.get(filePath)
  return entry?.imports || []
}

// ─── Part 1 (continued) — Search helpers ─────────────────────────────

export function findFilesByName(tree, name) {
  const lower = name.toLowerCase()
  return tree.filter(n =>
    n.filename.toLowerCase().includes(lower) || n.path.toLowerCase().includes(lower)
  )
}

export function findFilesByImport(tree, symbol) {
  const lower = symbol.toLowerCase()
  return tree.filter(n =>
    n.imports.some(imp => imp.toLowerCase().includes(lower))
  )
}

export function findFilesByExport(tree, symbol) {
  const lower = symbol.toLowerCase()
  return tree.filter(n =>
    n.exports.some(exp => exp.toLowerCase().includes(lower)) ||
    (n.componentName && n.componentName.toLowerCase().includes(lower))
  )
}

export function findSimilarFiles(tree, filePath) {
  const target = tree.find(n => n.path === filePath)
  if (!target) return []

  const dir = filePath.split('/').slice(0, -1).join('/')
  const ext = target.extension

  return tree
    .filter(n => n.path !== filePath)
    .map(n => {
      let score = 0
      // Same directory
      if (n.path.startsWith(dir + '/')) score += 5
      // Same extension
      if (n.extension === ext) score += 3
      // Shared imports
      const shared = n.imports.filter(i => target.imports.includes(i)).length
      score += shared * 2
      // Similar component name
      if (target.componentName && n.componentName) {
        if (n.componentName.toLowerCase().includes(target.componentName.toLowerCase().slice(0, 4))) score += 3
      }
      return { ...n, _score: score }
    })
    .filter(n => n._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 8)
}

// ─── Part 2 — Intent-aware context selection ─────────────────────────

const MAX_CONTEXT_FILES = 10
const MAX_CONTEXT_TOKENS = 30_000    // ~30k chars ≈ 30k tokens approx
const AVG_CHARS_PER_TOKEN = 4

/**
 * Build full filesystem context for AI based on intent and user message.
 * Returns structured context with selected relevant files including their content.
 */
export async function buildFilesystemContext(projectId, intent, userMessage) {
  const stats = { scannedCount: 0, readCount: 0, matchedCount: 0, changesCount: 0 }

  const tree = await getProjectTree(projectId)
  stats.scannedCount = tree.length
  if (!tree.length) return { ...stats, fileTree: [], relevantFiles: [], importMap: null, recentChanges: [], graph: null }

  const graph = await getFileGraph(projectId)

  // Intent-specific file selection
  let selectedPaths = []

  if (intent === 'build') {
    selectedPaths = selectForBuild(tree, graph, userMessage)
  } else if (intent === 'edit') {
    selectedPaths = selectForEdit(tree, graph, userMessage)
  } else if (intent === 'refactor') {
    selectedPaths = selectForRefactor(tree, graph, userMessage)
  } else if (intent === 'bug_fix') {
    selectedPaths = selectForBugFix(tree, graph, userMessage)
  } else if (intent === 'explain' || intent === 'architecture_analysis') {
    selectedPaths = selectForExplain(tree, graph, userMessage)
  } else {
    // chat / other — light context
    selectedPaths = selectByKeywords(tree, userMessage, 3)
  }

  // De-duplicate and limit
  selectedPaths = [...new Set(selectedPaths)].slice(0, MAX_CONTEXT_FILES)

  // FALLBACK: If no files matched, include entry points and top files by size
  if (selectedPaths.length === 0 && tree.length > 0 && intent !== 'chat') {
    // Always include entry points
    const entryPoints = tree.filter(n =>
      /^(index|app|main|page|layout)\.(js|jsx|ts|tsx|html)$/i.test(n.filename)
    )
    selectedPaths.push(...entryPoints.map(n => n.path))

    // Include largest code files as they're likely most important
    const codeFiles = tree
      .filter(n => ['js', 'jsx', 'ts', 'tsx', 'html', 'css'].includes(n.extension))
      .sort((a, b) => b.size - a.size)
    for (const f of codeFiles) {
      if (!selectedPaths.includes(f.path)) selectedPaths.push(f.path)
      if (selectedPaths.length >= 5) break
    }
  }

  // Load full content for selected files (from DB to get latest content)
  const files = await db.projectFiles.findByProjectId(projectId)
  const fileMap = new Map(files.map(f => [f.path, f]))

  let totalChars = 0
  const relevantFiles = []
  for (const path of selectedPaths) {
    const file = fileMap.get(path)
    if (!file?.content) continue
    if (totalChars + file.content.length > MAX_CONTEXT_TOKENS * AVG_CHARS_PER_TOKEN) break
    totalChars += file.content.length
    relevantFiles.push({
      path: file.path,
      content: file.content,
      file_type: file.file_type,
      version: file.version,
    })
  }

  stats.readCount = relevantFiles.length
  stats.matchedCount = selectedPaths.length

  // Recent changes for bug_fix
  let recentChanges = []
  if (intent === 'bug_fix') {
    recentChanges = await getRecentChanges(projectId, 10)
    stats.changesCount = recentChanges.length
  }

  // Build import map for refactor
  let importMap = null
  if (intent === 'refactor') {
    importMap = {}
    for (const [path, entry] of graph) {
      if (entry.imports.length > 0) {
        importMap[path] = entry.imports
      }
    }
    if (Object.keys(importMap).length === 0) importMap = null
  }

  return {
    ...stats,
    fileTree: tree.map(n => ({ path: n.path, file_type: n.extension, version: n.version, size: n.size, componentName: n.componentName })),
    relevantFiles,
    importMap,
    recentChanges,
    graph,
  }
}

// ─── Intent-specific selectors ───────────────────────────────────────

function selectForBuild(tree, graph, message) {
  const paths = []

  // 1. Find similar components by keyword
  paths.push(...selectByKeywords(tree, message, 5))

  // 2. Find files in related folders
  const mentionedDirs = extractMentionedDirs(tree, message)
  for (const dir of mentionedDirs) {
    const inDir = tree.filter(n => n.path.startsWith(dir + '/'))
    paths.push(...inDir.slice(0, 3).map(n => n.path))
  }

  // 3. Find files with matching imports (if user mentions a component name)
  const componentKeywords = extractComponentKeywords(message)
  for (const kw of componentKeywords) {
    const exporters = findFilesByExport(tree, kw)
    paths.push(...exporters.map(n => n.path))
    const importers = findFilesByImport(tree, kw)
    paths.push(...importers.slice(0, 2).map(n => n.path))
  }

  // 4. Always include entry points
  paths.push(...tree.filter(n =>
    /^(index|app|main|page|layout)\.(js|jsx|ts|tsx)$/.test(n.filename)
  ).map(n => n.path))

  return paths
}

function selectForEdit(tree, graph, message) {
  const paths = []

  // 1. Find explicitly mentioned files
  paths.push(...findMentionedFiles(tree, message))

  // 2. Keyword match
  paths.push(...selectByKeywords(tree, message, 5))

  // 3. For each mentioned file, include files that import it
  for (const p of [...paths]) {
    const entry = graph.get(p)
    if (entry?.importedBy.length) {
      paths.push(...entry.importedBy.slice(0, 2))
    }
  }

  return paths
}

function selectForRefactor(tree, graph, message) {
  const paths = []

  // 1. Find explicitly mentioned files — these are the refactor targets
  const targets = findMentionedFiles(tree, message)
  paths.push(...targets)

  // 2. For each target, include ALL files that import it (impact analysis)
  for (const t of targets) {
    const entry = graph.get(t)
    if (entry) {
      paths.push(...entry.importedBy)
      paths.push(...entry.imports)
    }
  }

  // 3. Keyword fallback if no explicit targets
  if (targets.length === 0) {
    paths.push(...selectByKeywords(tree, message, 6))
    // For each keyword match, get importers
    for (const p of [...paths]) {
      const entry = graph.get(p)
      if (entry?.importedBy.length) {
        paths.push(...entry.importedBy.slice(0, 3))
      }
    }
  }

  return paths
}

function selectForBugFix(tree, graph, message) {
  const paths = []

  // 1. Find explicitly mentioned files (error messages often reference file names)
  paths.push(...findMentionedFiles(tree, message))

  // 2. Keyword matching (error text, component names, function names)
  paths.push(...selectByKeywords(tree, message, 5))

  // 3. Likely source files based on error patterns
  const errorPatterns = message.match(/(?:at\s+|in\s+|from\s+)([A-Za-z0-9_./]+\.[a-z]+)/g)
  if (errorPatterns) {
    for (const pat of errorPatterns) {
      const filename = pat.replace(/^(?:at|in|from)\s+/, '').trim()
      const matches = findFilesByName(tree, filename)
      paths.push(...matches.map(n => n.path))
    }
  }

  // 4. For each matched file, include its dependencies
  for (const p of [...paths]) {
    const entry = graph.get(p)
    if (entry) {
      paths.push(...entry.imports.slice(0, 2))
    }
  }

  return paths
}

function selectForExplain(tree, graph, message) {
  const paths = []
  paths.push(...findMentionedFiles(tree, message))
  paths.push(...selectByKeywords(tree, message, 5))
  return paths
}

// ─── Shared helpers ──────────────────────────────────────────────────

function selectByKeywords(tree, message, limit) {
  const lower = message.toLowerCase()
  const keywords = lower
    .replace(/[^a-z0-9\s_.-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))

  return tree
    .map(n => {
      const pathLower = n.path.toLowerCase()
      let score = 0
      for (const kw of keywords) {
        if (pathLower.includes(kw)) score += 3
        if (n.componentName?.toLowerCase().includes(kw)) score += 4
        if (n.exports.some(e => e.toLowerCase().includes(kw))) score += 2
      }
      return { path: n.path, score }
    })
    .filter(n => n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(n => n.path)
}

function findMentionedFiles(tree, message) {
  const lower = message.toLowerCase()
  const found = []
  for (const n of tree) {
    const basename = n.filename.toLowerCase()
    if (lower.includes(basename)) found.push(n.path)
  }
  return found
}

function extractMentionedDirs(tree, message) {
  const lower = message.toLowerCase()
  const dirs = new Set()
  for (const n of tree) {
    const parts = n.path.split('/')
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join('/')
      if (lower.includes(parts[parts.length - 2]?.toLowerCase())) {
        dirs.add(dir)
      }
    }
  }
  return [...dirs].slice(0, 3)
}

function extractComponentKeywords(message) {
  // Extract PascalCase words as potential component names
  const matches = message.match(/\b([A-Z][a-zA-Z0-9]+)\b/g)
  return matches ? [...new Set(matches)] : []
}

// ─── Part 4 — Safe multi-file editing validation ─────────────────────

/**
 * Validate a set of file operations before applying them.
 * Returns { valid: boolean, errors: string[], warnings: string[] }
 */
export async function validateFileOperations(projectId, operations) {
  const errors = []
  const warnings = []
  const tree = await getProjectTree(projectId)
  const existingPaths = new Set(tree.map(n => n.path))

  const creates = operations.filter(op => op.action === 'create')
  const updates = operations.filter(op => op.action === 'update')
  const deletes = operations.filter(op => op.action === 'delete')

  // Check creates: warn if file already exists
  for (const op of creates) {
    if (existingPaths.has(op.path)) {
      warnings.push(`File "${op.path}" already exists — will be overwritten`)
    }
  }

  // Check updates: error if file doesn't exist
  for (const op of updates) {
    if (!existingPaths.has(op.path)) {
      errors.push(`Cannot update "${op.path}" — file does not exist`)
    }
  }

  // Check deletes: error if file doesn't exist, warn about dependents
  for (const op of deletes) {
    if (!existingPaths.has(op.path)) {
      errors.push(`Cannot delete "${op.path}" — file does not exist`)
    } else {
      const graph = await getFileGraph(projectId)
      const entry = graph.get(op.path)
      if (entry?.importedBy.length) {
        warnings.push(`Deleting "${op.path}" will break imports in: ${entry.importedBy.join(', ')}`)
      }
    }
  }

  // Check for path traversal attacks
  for (const op of [...creates, ...updates, ...deletes]) {
    if (op.path.includes('..') || op.path.startsWith('/')) {
      errors.push(`Invalid path "${op.path}" — must be relative and not contain ".."`)
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ─── Part 3 (helper) — Format filesystem context for AI prompt ───────

/**
 * Format the filesystem context as a prompt block for the AI.
 */
export function formatFilesystemContextBlock(fsContext) {
  if (!fsContext || fsContext.scannedCount === 0) return ''

  const parts = []

  parts.push('## PROJECT FILESYSTEM CONTEXT')
  parts.push('')

  // File tree overview
  if (fsContext.fileTree?.length) {
    parts.push(`### Files in project (${fsContext.fileTree.length} total)`)
    for (const f of fsContext.fileTree) {
      const comp = f.componentName ? ` [${f.componentName}]` : ''
      parts.push(`- ${f.path} (${f.file_type || '?'}, v${f.version}, ${f.size}b)${comp}`)
    }
    parts.push('')
  }

  // Relevant file contents
  if (fsContext.relevantFiles?.length) {
    parts.push(`### Relevant files included for analysis (${fsContext.relevantFiles.length})`)
    parts.push('')
    for (const f of fsContext.relevantFiles) {
      parts.push(`--- FILE: ${f.path} (v${f.version}) ---`)
      parts.push('```')
      parts.push(f.content)
      parts.push('```')
      parts.push('')
    }
  }

  // Relationship info
  if (fsContext.importMap) {
    parts.push('### Import/Dependency Map')
    for (const [file, deps] of Object.entries(fsContext.importMap)) {
      parts.push(`- ${file} → imports: ${deps.join(', ')}`)
    }
    parts.push('')
  }

  // Recent changes
  if (fsContext.recentChanges?.length) {
    parts.push('### Recent File Changes')
    for (const c of fsContext.recentChanges) {
      parts.push(`- ${c.file_path}: ${c.action} (${c.changes || 'no description'}) at ${c.created_at}`)
    }
    parts.push('')
  }

  // Instructions
  parts.push('### Filesystem Rules')
  parts.push('- REUSE existing files when possible — check the file tree before creating new ones')
  parts.push('- MODIFY existing files rather than duplicating')
  parts.push('- RESPECT the project directory structure')
  parts.push('- UPDATE all import statements if you rename or move files')
  parts.push('- When generating multiple files, return them as a structured set with create/update/delete actions')
  parts.push('')

  return parts.join('\n')
}

// ─── Utility ────────────────────────────────────────────────────────

async function getRecentChanges(projectId, limit = 10) {
  try {
    const events = await db.fileChangeEvents.findByProjectId(projectId)
    return (events || []).slice(0, limit).map(e => ({
      file_path: e.file_path,
      action: e.action,
      changes: e.changes,
      created_at: e.created_at,
    }))
  } catch {
    return []
  }
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has',
  'can', 'will', 'just', 'not', 'but', 'are', 'was', 'were', 'been',
  'being', 'does', 'did', 'should', 'would', 'could', 'may', 'might',
  'please', 'want', 'need', 'like', 'make', 'use', 'get', 'add',
  'new', 'some', 'all', 'any', 'one', 'two', 'also', 'more', 'very',
  'file', 'code', 'project', 'help', 'create', 'build', 'update',
])
