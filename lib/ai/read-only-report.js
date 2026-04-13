/**
 * Read-only report helpers for the `read_only_report` request-mode path.
 *
 * File-resolution, directive-building, and history-cleaning functions.
 * No streaming, no provider calls, no generator yields.
 */

// ── File-path extraction from user message ──────────────────────────────

/**
 * Extract file-path candidates from a user message via regex.
 * Returns a deduplicated array of candidate strings.
 */
export function extractFileCandidates(userMessage) {
  const pathMatches = userMessage.match(/(?:[\w./-]+\/[\w.-]+\.\w+)/g) || []
  const nameMatches = userMessage.match(/\b([\w.-]+\.(jsx?|tsx?|css|html|json|md|py|sql|yml|yaml|toml))\b/gi) || []
  return [...new Set([...pathMatches, ...nameMatches])]
}

// ── Project-DB file resolution ──────────────────────────────────────────

/**
 * Resolve file candidates against the project DB file list.
 * Returns `{ directReadFiles, requestedFileFound }`.
 *
 * Pure lookup — no DB calls, operates on pre-fetched `allFiles`.
 */
export function resolveFromProjectFiles(candidates, allFiles, fsContext) {
  const fileMap = new Map(allFiles.map(f => [f.path, f]))
  const baseMap = new Map(allFiles.map(f => [((f.path || '').split('/').pop() || '').toLowerCase(), f]))
  const loadedPaths = new Set((fsContext?.relevantFiles || []).map(f => f.path))

  const directReadFiles = []
  let requestedFileFound = false

  for (const raw of candidates) {
    const norm = raw.replace(/^\.?\/?(app\/)?/, '')
    const basename = norm.split('/').pop().toLowerCase()
    const file = fileMap.get(norm) || fileMap.get(raw) || baseMap.get(basename)
    if (file?.content) {
      requestedFileFound = true
      if (!loadedPaths.has(file.path)) {
        directReadFiles.push(file)
        loadedPaths.add(file.path)
      }
    }
  }

  return { directReadFiles, requestedFileFound, loadedPaths }
}

// ── Filesystem fallback resolution ──────────────────────────────────────

/**
 * Fallback: try to find requested files on the actual filesystem.
 * Used when files aren't in the project DB (self-builder use case).
 * Returns `{ files, found }`.
 */
export async function resolveFromFilesystem(candidates) {
  const { readFileSync, existsSync } = await import('fs')
  const { resolve, extname } = await import('path')
  const { execSync } = await import('child_process')

  const files = []
  let found = false

  for (const raw of candidates) {
    // 1. Try full path directly under /app/
    const directPath = resolve('/app', raw)
    if (directPath.startsWith('/app/') && existsSync(directPath)) {
      try {
        const content = readFileSync(directPath, 'utf-8')
        files.push({ path: raw, content, file_type: extname(directPath).slice(1) })
        found = true
        break
      } catch {}
    }
    // 2. Recursive find by exact basename
    const basename = raw.split('/').pop()
    if (!found && basename) {
      try {
        const result = execSync(
          `find /app -maxdepth 6 -name "${basename}" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/.git/*" -type f 2>/dev/null | head -1`,
          { encoding: 'utf-8', timeout: 3000 }
        ).trim()
        if (result && existsSync(result)) {
          const content = readFileSync(result, 'utf-8')
          const relPath = result.replace(/^\/app\//, '')
          files.push({ path: relPath, content, file_type: extname(result).slice(1) })
          found = true
          break
        }
      } catch {}
    }
  }

  return { files, found }
}

// ── System-message block builders ───────────────────────────────────────

/**
 * Build the "## Inspected File Contents" block for the system message.
 * Returns the block string, or '' if no files.
 */
export function buildInspectedContentsBlock(directReadFiles) {
  if (directReadFiles.length === 0) return ''
  let block = '\n\n## Inspected File Contents\n'
  for (const f of directReadFiles) {
    block += `\n### ${f.path}\n\`\`\`${f.file_type || ''}\n${f.content}\n\`\`\`\n`
  }
  return block
}

/**
 * Check whether fsContext already contains the requested file(s).
 */
export function fsContextHasRequestedFile(candidates, fsContext) {
  if (candidates.length === 0) return false
  return (fsContext?.relevantFiles || []).some(f => {
    const fBase = ((f.path || '').split('/').pop() || '').toLowerCase()
    return candidates.some(c => {
      const cBase = c.split('/').pop().toLowerCase()
      return fBase === cBase || f.path === c || f.path.endsWith('/' + c)
    })
  })
}

/**
 * Build the read-only inspection directive to append to the system message.
 * Returns the directive string.
 */
export function buildReadOnlyDirective({ hasRequestedFileContent, candidates, allFiles }) {
  if (hasRequestedFileContent) {
    return `\n\n## READ-ONLY INSPECTION MODE — MANDATORY INSTRUCTIONS
You are in READ-ONLY FILE INSPECTION mode. The actual file contents have been loaded and provided above in this system message.

CRITICAL RULES:
1. You HAVE direct access to the file contents shown above. They are REAL, loaded from the project or filesystem.
2. You MUST present, analyze, and discuss the actual file contents shown above.
3. NEVER say "I'm unable to open files", "I cannot inspect files directly", "I do not have access", or any similar refusal. The files ARE loaded above.
4. Do NOT propose any code changes, plans, or file_actions. This is a READ-ONLY inspection.
5. Provide a thorough analysis: structure, key functions, exports, dependencies, patterns, and any issues you notice.`
  }

  const fileList = allFiles.map(f => f.path).join(', ')
  const candidateList = candidates.join(', ')
  return `\n\n## READ-ONLY INSPECTION MODE — FILE NOT FOUND
You are in READ-ONLY FILE INSPECTION mode. The user requested to inspect: ${candidateList}
However, this file was NOT found in the project database or the application filesystem.
${allFiles.length > 0 ? `\nFiles available in this project: ${fileList}` : '\nThis project has no stored files yet.'}
\nTell the user clearly that "${candidateList}" was not found in this project. List the available files. Suggest they either switch to the correct project or upload the file first.
Do NOT propose any code changes, plans, or file_actions. This is a READ-ONLY inspection.
Do NOT fabricate or guess file contents.`
}

// ── Chat-history hardening ──────────────────────────────────────────────

const REFUSAL_PATTERNS = /unable to (access|open|inspect|read)|cannot (inspect|open|access|read)|can't (access|open|inspect|read)|not able to (access|open|read)|do not have access|don't have (access|the ability)|I apologize.*(?:cannot|unable|can't)/i

/**
 * Strip assistant messages that contain refusal patterns from chat history.
 * Returns the last 4 clean messages.
 */
export function cleanRefusalHistory(chatMessages) {
  return (chatMessages || []).filter(m => {
    if (m.role === 'assistant' && REFUSAL_PATTERNS.test(m.content || '')) return false
    return true
  }).slice(-12)
}

/**
 * Collect all loaded files (from fsContext + directReadFiles) de-duped by path.
 */
export function collectEmbeddedFiles(fsContext, directReadFiles) {
  const files = []
  const seenPaths = new Set()
  if (fsContext?.relevantFiles?.length > 0) {
    for (const f of fsContext.relevantFiles) {
      if (f.content && !seenPaths.has(f.path)) {
        files.push(f)
        seenPaths.add(f.path)
      }
    }
  }
  for (const f of directReadFiles) {
    if (f.content && !seenPaths.has(f.path)) {
      files.push(f)
      seenPaths.add(f.path)
    }
  }
  return files
}

/**
 * Build the augmented user message with file contents embedded directly.
 */
export function buildAugmentedUserMessage(userMessage, embeddedFiles) {
  if (embeddedFiles.length === 0) return userMessage
  let msg = userMessage
  msg += '\n\n--- FILE CONTENTS (loaded from project database) ---'
  for (const f of embeddedFiles) {
    msg += `\n\n### ${f.path}\n\`\`\`${f.file_type || ''}\n${f.content}\n\`\`\``
  }
  msg += '\n\n--- END FILE CONTENTS ---\n\nAnalyze the file contents above. Do NOT say you cannot access files — the contents are provided above.'
  return msg
}
