// ── Project Files Adapter ──
//
// Implements the same reader/writer interface as github-writer.js but
// against Supabase's `project_files` table. This is what lets the v2
// agent work on PROJECT chats (Nexsara, etc.) the same way Core System
// chats work — same loop, same tools, same UI rendering.
//
// Interface (matches buildGithubReader + buildGithubWriter):
//   { isConfigured, repo, branch,
//     readFile(path, maxBytes?)   → { content, lineCount, source }
//     writeFile(path, content, message?) → string status message
//     editFile(path, old, new, message?) → string status message
//     listFiles(name_pattern, basePath?) → string[] (full repo paths)
//     searchFiles(pattern, basePath?) → string (formatted matches) }
//
// Pure data adapter — no LLM concerns, no SSE concerns. Easy to test.

const DEFAULT_MAX_BYTES = 200 * 1024

/**
 * @param {object} opts
 * @param {object} opts.db          — the db object from /lib/supabase/db.js
 * @param {string} opts.projectId   — the project to scope to
 * @param {string} [opts.projectName] — display label (for tool descriptions)
 * @returns {object|null}
 */
export function buildProjectFs({ db, projectId, projectName }) {
  if (!db || !projectId || !db.projectFiles) return null

  const labelPrefix = projectName || ('project:' + String(projectId).slice(0, 8))

  function matchesGlob(filePath, pattern) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const re = new RegExp('^' + escaped + '$')
    const baseName = filePath.split('/').pop()
    return re.test(baseName) || re.test(filePath)
  }

  function normalizePath(p) {
    return String(p || '').replace(/^\/+/, '')
  }

  return {
    isConfigured: true,
    repo: labelPrefix,
    branch: 'project',
    projectId,

    async readFile(reqPath, maxBytes = DEFAULT_MAX_BYTES) {
      const filePath = normalizePath(reqPath)
      const row = await db.projectFiles.findByPath(projectId, filePath)
      if (!row) throw new Error(`"${filePath}" not found in ${labelPrefix}`)
      const raw = typeof row.content === 'string' ? row.content : String(row.content || '')
      const truncated = raw.length > maxBytes
      const content = truncated
        ? raw.slice(0, maxBytes) + `\n[truncated at ${maxBytes} bytes]`
        : raw
      const lineCount = raw.split('\n').length
      return { content, lineCount, truncated, source: `${labelPrefix}/${filePath}` }
    },

    async writeFile(reqPath, content, _message) {
      const filePath = normalizePath(reqPath)
      if (typeof content !== 'string') throw new Error('content must be a string')
      const result = await db.projectFiles.upsert(projectId, filePath, content)
      const action = result?.action || 'saved'
      
      // ── Auto-start preview on first entry-point write ──────────────────
      // When an agent builds a new project from scratch, it writes 20+
      // files but the preview never auto-starts. The user must manually
      // click "Start Preview" before the agent can call screenshot_preview
      // or preview_diagnostics. This hook detects entry-point files
      // (package.json, index.html, vite.config.js, etc.) and auto-triggers
      // preview allocation if no machine exists yet. Fire-and-forget: never
      // block the write on preview infra latency.
      const ENTRY_POINT_FILES = [
        'package.json',
        'index.html',
        'vite.config.js',
        'vite.config.ts',
        'next.config.js',
        'next.config.mjs',
        'nuxt.config.js',
        'nuxt.config.ts',
        'svelte.config.js',
      ]
      const isEntryPoint = ENTRY_POINT_FILES.some((ep) => filePath === ep || filePath.endsWith('/' + ep))
      
      if (isEntryPoint && action === 'created') {
        // Only auto-start on CREATE (not UPDATE) to avoid re-triggering
        // on every package.json edit. Import dynamically to avoid circular
        // dependency (project-fs is used by stream-handler which imports
        // the preview start route).
        setImmediate(async () => {
          try {
            const { findMachineForProject } = await import('@/lib/fly/machines.js')
            const machine = await findMachineForProject(projectId)
            if (!machine) {
              console.log(`[project-fs] auto-starting preview for project ${projectId} (entry point: ${filePath})`)
              // Trigger the start endpoint via internal fetch. Use the
              // deployment's own base URL so we don't need to construct
              // auth headers — the endpoint will run in the same process.
              const base = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}`
                : process.env.NEXTAUTH_URL || 'http://localhost:3000'
              const res = await fetch(`${base}/api/previews/${projectId}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // No auth header needed — internal call, same process
              }).catch((err) => {
                console.warn(`[project-fs] auto-start fetch failed: ${err.message}`)
                return null
              })
              if (res?.ok) {
                console.log(`[project-fs] preview auto-start triggered for project ${projectId}`)
              } else {
                console.warn(`[project-fs] preview auto-start returned ${res?.status || 'error'}`)
              }
            }
          } catch (err) {
            console.warn(`[project-fs] auto-start check failed: ${err.message}`)
          }
        })
      }
      
      return `${action === 'updated' ? 'Updated' : 'Created'} ${filePath} in ${labelPrefix} (${content.length} bytes). The live preview will reflect this change on next render.`
    },

    async editFile(reqPath, old_str, new_str, _message) {
      if (typeof old_str !== 'string' || !old_str) {
        throw new Error('old_str must be a non-empty string')
      }
      const filePath = normalizePath(reqPath)
      const row = await db.projectFiles.findByPath(projectId, filePath)
      if (!row) throw new Error(`"${filePath}" not found in ${labelPrefix}`)
      const raw = typeof row.content === 'string' ? row.content : String(row.content || '')
      const idx = raw.indexOf(old_str)
      if (idx === -1) throw new Error(`old_str not found in "${filePath}"`)
      const second = raw.indexOf(old_str, idx + old_str.length)
      if (second !== -1) {
        throw new Error(`old_str matches multiple locations in "${filePath}" — include more surrounding context to make it unique`)
      }
      const next = raw.slice(0, idx) + (new_str || '') + raw.slice(idx + old_str.length)
      await db.projectFiles.upsert(projectId, filePath, next)
      return `Edited ${filePath} in ${labelPrefix} (${old_str.length} → ${(new_str || '').length} bytes). The live preview will reflect this change on next render.`
    },

    async deleteFile(reqPath, _message) {
      const filePath = normalizePath(reqPath)
      if (!filePath) throw new Error('path must be a non-empty string')
      const result = await db.projectFiles.deleteByPath(projectId, filePath)
      if (!result.deleted) {
        // Idempotent success — model can move on without retry-looping.
        return `${filePath} was not present in ${labelPrefix} (already deleted or never existed).`
      }
      return `Deleted ${filePath} from ${labelPrefix}. The live preview will reflect this on next render.`
    },

    async listFiles(name_pattern, basePath) {
      const idx = await db.projectFiles.findIndexByProjectId(projectId)
      const base = basePath ? normalizePath(basePath) : null
      const matches = (idx || [])
        .map((f) => f.path)
        .filter((p) => (!base || p.startsWith(base)) && matchesGlob(p, name_pattern))
        .slice(0, 100)
      return matches
    },

    async searchFiles(pattern, basePath) {
      // Project files live in the DB and are typically small (a few KB
      // per file, dozens to hundreds of files). Load + grep in memory.
      const allFiles = await db.projectFiles.findByProjectId(projectId)
      const base = basePath ? normalizePath(basePath) : null
      const out = []
      let regex
      try {
        regex = new RegExp(pattern, 'i')
      } catch {
        regex = new RegExp(pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i')
      }
      for (const f of allFiles) {
        if (base && !f.path.startsWith(base)) continue
        const content = typeof f.content === 'string' ? f.content : ''
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            out.push(`${f.path}:${i + 1}: ${lines[i].slice(0, 200)}`)
            if (out.length >= 50) break
          }
        }
        if (out.length >= 50) break
      }
      if (out.length === 0) return `(no matches for "${pattern}" in ${labelPrefix})`
      return out.join('\n')
    },
  }
}
