/**
 * Internal-API-exec helpers for the `internal_api_exec` request-mode bypass.
 *
 * Pure parsing, validation, execution, and formatting functions.
 * No streaming, no provider calls, no generator yields.
 */

// ── Route whitelist ─────────────────────────────────────────────────────

const ALLOWED_ROUTES = [
  { method: 'GET',    pattern: /^\/api\/projects\/[^/]+\/memory$/ },
  { method: 'POST',   pattern: /^\/api\/projects\/[^/]+\/memory$/ },
  { method: 'DELETE', pattern: /^\/api\/projects\/[^/]+\/memory\/[^/]+$/ },
  { method: 'POST',   pattern: /^\/api\/projects\/[^/]+\/sync-repo$/ },
]

// ── Message parsing ─────────────────────────────────────────────────────

/**
 * Parse an API call (method + path + optional body) from a user message.
 * Returns `{ method, apiPath, body }` or `null` if unparseable.
 */
export function parseApiCall(userMessage, projectId) {
  const methodMatch = userMessage.match(/\b(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^\s]+)/i)
  if (!methodMatch) return null

  const method = methodMatch[1].toUpperCase()
  const apiPath = methodMatch[2].replace(/\{projectId\}/g, projectId)

  let body = null
  const bodyMatch =
    userMessage.match(/body:\s*(\{[\s\S]*?\})/i) ||
    userMessage.match(/```json\s*([\s\S]*?)```/)
  if (bodyMatch) {
    try { body = JSON.parse(bodyMatch[1]) } catch {}
  }

  return { method, apiPath, body }
}

// ── Whitelist check ─────────────────────────────────────────────────────

/**
 * Check whether a method + path pair is in the allowed whitelist.
 */
export function isRouteAllowed(method, apiPath) {
  return ALLOWED_ROUTES.some(r => r.method === method && r.pattern.test(apiPath))
}

// ── Execution (DB-layer dispatch) ───────────────────────────────────────

/**
 * Execute an internal API call directly via the DB layer.
 * Returns `{ status: number, responseBody: any }`.
 *
 * @param {string} method   - HTTP method
 * @param {string} apiPath  - Resolved API path
 * @param {object|null} body - Parsed request body
 * @param {string} projectId
 * @param {object} db       - DB access object (injected, not imported)
 */
export async function executeInternalApi(method, apiPath, body, projectId, db) {
  let status = 200
  let responseBody = null

  try {
    if (method === 'GET' && apiPath.match(/\/memory$/)) {
      responseBody = await db.projectMemory.findByProjectId(projectId)
    } else if (method === 'POST' && apiPath.match(/\/memory$/)) {
      if (!body?.key) {
        status = 400
        responseBody = { error: 'Missing key' }
      } else {
        responseBody = await db.projectMemory.create({ project_id: projectId, key: body.key, value: body.value || '' })
        status = 201
      }
    } else if (method === 'DELETE' && apiPath.match(/\/memory\/[^/]+$/)) {
      const memoryId = apiPath.split('/').pop()
      await db.projectMemory.deleteById(memoryId)
      responseBody = { success: true }
    } else if (method === 'POST' && apiPath.match(/\/sync-repo$/)) {
      responseBody = await syncRepoFiles(projectId, db)
    }
  } catch (err) {
    status = 500
    responseBody = { error: err.message }
  }

  return { status, responseBody }
}

// ── Sync-repo filesystem walk (used only by executeInternalApi) ─────────

async function syncRepoFiles(projectId, db) {
  const fs = await import('fs/promises')
  const nodePath = await import('path')
  const BASE = process.cwd()
  const SYNC_DIRS = ['lib', 'app', 'components']
  const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.json', '.md'])
  const SKIP = new Set(['node_modules', '.next', '.git', '.emergent', 'dist', 'build'])

  async function walkDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const out = []
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const full = nodePath.join(dir, e.name)
      if (e.isDirectory()) out.push(...await walkDir(full))
      else if (EXTENSIONS.has(nodePath.extname(e.name).toLowerCase())) out.push(full)
    }
    return out
  }

  let synced = 0
  for (const dir of SYNC_DIRS) {
    const absDir = nodePath.join(BASE, dir)
    try { await fs.access(absDir) } catch { continue }
    for (const absPath of await walkDir(absDir)) {
      const relPath = nodePath.relative(BASE, absPath)
      try {
        const content = await fs.readFile(absPath, 'utf-8')
        await db.projectFiles.upsert(projectId, relPath, content, nodePath.extname(absPath).replace('.', '') || 'text')
        synced++
      } catch {}
    }
  }

  for (const name of ['package.json', 'next.config.mjs', 'tailwind.config.js', 'postcss.config.mjs', 'jsconfig.json']) {
    try {
      const content = await fs.readFile(nodePath.join(BASE, name), 'utf-8')
      await db.projectFiles.upsert(projectId, name, content, nodePath.extname(name).replace('.', '') || 'text')
      synced++
    } catch {}
  }

  return { success: true, synced }
}

// ── Content / event-data builders ───────────────────────────────────────

export const PARSE_ERROR_CONTENT =
  '## Internal API Execution Error\n\nCould not parse API call. Expected format:\n```\nGET /api/projects/{projectId}/memory\n```'

export function buildDeniedContent(method, apiPath) {
  return (
    `## Internal API Execution Denied\n\n` +
    `Route not allowed: \`${method} ${apiPath}\`\n\n` +
    `Allowed routes:\n` +
    `- GET /api/projects/{projectId}/memory\n` +
    `- POST /api/projects/{projectId}/memory\n` +
    `- DELETE /api/projects/{projectId}/memory/{id}\n` +
    `- POST /api/projects/{projectId}/sync-repo`
  )
}

export function buildExecResultContent(method, apiPath, body, status, responseBody) {
  return (
    `## Internal API Execution\n\n` +
    `**${method}** \`${apiPath}\`` +
    (body ? `\n**Body:** \`${JSON.stringify(body)}\`` : '') +
    `\n\n**Status:** ${status}\n` +
    `**Response:**\n\`\`\`json\n${JSON.stringify(responseBody, null, 2)}\n\`\`\``
  )
}

export function buildExecDoneData(content, { requestedScope, runId, providerName, modelName }) {
  return {
    content,
    toolMode: 'internal_api_exec',
    scope: requestedScope || 'project',
    runId,
    provider: providerName,
    model: modelName,
  }
}
