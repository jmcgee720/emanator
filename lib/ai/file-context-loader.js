/**
 * FileContextLoader
 * Loads real file contents for grounded planning — no hallucinated diffs.
 */
import { db } from '@/lib/supabase/db'

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /sample text/i,
  /dummy text/i,
]

/**
 * Load grounded file context for a set of target paths.
 * Returns structured context with real file contents or NONEXISTENT markers.
 */
export async function loadFileContext(projectId, targetPaths) {
  const allFiles = await db.projectFiles.findByProjectId(projectId)
  const fileMap = new Map()
  for (const f of allFiles) {
    fileMap.set(f.path, f)
    const norm = f.path.replace(/^\.\//, '').replace(/^\//, '')
    if (norm !== f.path) fileMap.set(norm, f)
  }

  const contextEntries = []
  for (const rawPath of targetPaths) {
    const norm = rawPath.replace(/^\.\//, '').replace(/^\//, '')
    const file = fileMap.get(rawPath) || fileMap.get(norm) || null
    if (file) {
      contextEntries.push({
        path: file.path,
        exists: true,
        content: file.content,
        fileType: file.file_type || null,
        size: file.content?.length || 0,
      })
    } else {
      contextEntries.push({
        path: rawPath,
        exists: false,
        content: null,
        fileType: null,
        size: 0,
      })
    }
  }

  return {
    files: contextEntries,
    existingPaths: contextEntries.filter(e => e.exists).map(e => e.path),
    nonexistentPaths: contextEntries.filter(e => !e.exists).map(e => e.path),
    allProjectPaths: allFiles.map(f => f.path),
  }
}

/**
 * Build the grounded prompt block that gets injected into the planner system message.
 */
export function buildGroundedPromptBlock(fileContext) {
  const parts = ['## Grounded File Context (REAL — not assumed)']
  parts.push('The following file contents are loaded directly from the project database.')
  parts.push('You MUST anchor all edits to the real code shown below.')
  parts.push('Do NOT use filler content like "lorem ipsum", "sample text", "dummy text", TODO, or FIXME in generated code.')
  parts.push('')

  for (const entry of fileContext.files) {
    if (entry.exists) {
      parts.push(`### FILE: ${entry.path} [EXISTS, ${entry.size} chars, type: ${entry.fileType || 'unknown'}]`)
      parts.push('```')
      // Cap at 30k chars to avoid blowing context
      parts.push(entry.content?.slice(0, 30000) || '(empty file)')
      parts.push('```')
    } else {
      parts.push(`### FILE: ${entry.path} [NONEXISTENT — will be created from scratch]`)
      parts.push('This file does not exist yet. Any plan action for it must use action: "create".')
    }
    parts.push('')
  }

  if (fileContext.allProjectPaths.length > 0) {
    parts.push('### All project files:')
    for (const p of fileContext.allProjectPaths) {
      parts.push(`- ${p}`)
    }
    parts.push('')
  }

  return parts.join('\n')
}

/**
 * Extract target file paths from user message and plan hints.
 * Looks for explicit file references and common code patterns.
 */
export function extractTargetPaths(userMessage, existingPaths = []) {
  const paths = new Set()

  // Extract quoted file paths
  const quotedPaths = userMessage.match(/["`']([^"`'\s]+\.\w{1,6})["`']/g) || []
  for (const q of quotedPaths) {
    paths.add(q.replace(/["`']/g, ''))
  }

  // Extract paths from backtick code references
  const backtickPaths = userMessage.match(/`([^`\s]+\.\w{1,6})`/g) || []
  for (const b of backtickPaths) {
    paths.add(b.replace(/`/g, ''))
  }

  // Match known project paths mentioned in the message
  for (const p of existingPaths) {
    const filename = p.split('/').pop()
    if (userMessage.includes(filename) || userMessage.includes(p)) {
      paths.add(p)
    }
  }

  return [...paths]
}

/**
 * Check if a string contains placeholder language that should be rejected.
 */
export function containsPlaceholderLanguage(text) {
  if (!text) return false
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) return true
  }
  return false
}
