// ── GitHub Writer ──
//
// Replaces the fs-backed write/edit tools when running on a serverless /
// read-only filesystem (Vercel, etc). Commits changes directly to a
// configured GitHub repo via the Contents API. Vercel will auto-deploy
// the change on push, completing the round-trip:
//
//   user → "edit this file"
//   agent → reads file from bundled cwd
//   agent → commits change via this writer
//   GitHub → triggers Vercel deploy
//   change is live ~2 min later
//
// Required env vars (must be set in Vercel project settings):
//   GITHUB_TOKEN        — fine-grained PAT with Contents:write on the repo
//   GITHUB_REPO         — owner/name, e.g. "jmcgee720/emanator"
//   GITHUB_BRANCH       — defaults to "main"
//
// No SDK dependency — uses fetch + Buffer (Node 20+ has both natively).

import { syntaxLintBeforeCommit } from './syntax-lint.js'

const DEFAULT_BRANCH = 'main'
const GITHUB_API = 'https://api.github.com'

/**
 * Build a configured GitHub writer. Returns null if required env vars
 * are missing — caller must surface a clear error to the agent.
 *
 * @param {object} [opts]  optional override (used by tests)
 * @returns {object|null}  { writeFile, editFile, isConfigured: true } or null
 */
export function buildGithubWriter(opts = {}) {
  const token = opts.token ?? process.env.GITHUB_TOKEN
  const repo = opts.repo ?? process.env.GITHUB_REPO
  const branch = opts.branch ?? process.env.GITHUB_BRANCH ?? DEFAULT_BRANCH
  const fetchImpl = opts.fetch ?? globalThis.fetch

  if (!token || !repo) {
    return null
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error(`GITHUB_REPO must be in "owner/name" format, got: ${repo}`)
  }

  const apiBase = `${GITHUB_API}/repos/${repo}/contents`
  const baseHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'auroraly-agent-v2',
  }

  async function getFile(repoPath) {
    const url = `${apiBase}/${encodeURIComponent(repoPath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`
    const res = await fetchImpl(url, { headers: baseHeaders })
    if (res.status === 404) return null
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub GET ${repoPath} failed (${res.status}): ${body.slice(0, 300)}`)
    }
    const json = await res.json()
    const buf = Buffer.from(json.content || '', json.encoding || 'base64')
    return { sha: json.sha, content: buf.toString('utf-8') }
  }

  async function putFile(repoPath, content, message, sha) {
    const url = `${apiBase}/${encodeURIComponent(repoPath).replace(/%2F/g, '/')}`
    const body = {
      message: message || `Auroraly agent: update ${repoPath}`,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch,
    }
    if (sha) body.sha = sha
    const res = await fetchImpl(url, {
      method: 'PUT',
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`GitHub PUT ${repoPath} failed (${res.status}): ${errBody.slice(0, 300)}`)
    }
    const json = await res.json()
    return {
      sha: json.commit?.sha,
      url: json.commit?.html_url,
    }
  }

  async function deleteFileOnGithub(repoPath, message, sha) {
    const url = `${apiBase}/${encodeURIComponent(repoPath).replace(/%2F/g, '/')}`
    const body = {
      message: message || `Auroraly agent: delete ${repoPath}`,
      sha,
      branch,
    }
    const res = await fetchImpl(url, {
      method: 'DELETE',
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`GitHub DELETE ${repoPath} failed (${res.status}): ${errBody.slice(0, 300)}`)
    }
    const json = await res.json()
    return { sha: json.commit?.sha, url: json.commit?.html_url }
  }

  return {
    isConfigured: true,
    repo,
    branch,

    /**
     * Create or overwrite a file in the GitHub repo.
     * @param {string} repoPath  path relative to repo root (e.g. "lib/foo.js")
     * @param {string} content   full new content
     * @param {string} [message] commit message
     */
    async writeFile(repoPath, content, message) {
      if (typeof content !== 'string') throw new Error('content must be a string')
      // ── Pre-commit syntax gate ───────────────────────────────────
      // Parses .js/.jsx/.ts/.tsx with @babel/parser and validates
      // .json with JSON.parse before the commit lands. Catches the
      // ~95% of "agent breaks main" failures that are syntax-level
      // (missing close brace, stray comma, unclosed JSX tag). Failed
      // lint = thrown error = agent sees a tool failure and retries.
      // Live deploy never sees the broken file.
      const lintError = syntaxLintBeforeCommit(repoPath, content)
      if (lintError) throw new Error(lintError)
      const existing = await getFile(repoPath)
      const result = await putFile(
        repoPath,
        content,
        message || `Auroraly agent: ${existing ? 'update' : 'create'} ${repoPath}`,
        existing?.sha
      )
      return `Committed ${repoPath} → ${repo}@${branch} (${result.sha?.slice(0, 7)}). Vercel will redeploy automatically.${result.url ? ' ' + result.url : ''}`
    },

    /**
     * Surgical edit: fetch the file, replace exactly-one occurrence of
     * old_str with new_str, commit the result.
     */
    async editFile(repoPath, old_str, new_str, message) {
      if (typeof old_str !== 'string' || !old_str) {
        throw new Error('old_str must be a non-empty string')
      }
      const existing = await getFile(repoPath)
      if (!existing) throw new Error(`"${repoPath}" does not exist on ${repo}@${branch}`)
      const idx = existing.content.indexOf(old_str)
      if (idx === -1) throw new Error(`old_str not found in "${repoPath}"`)
      const second = existing.content.indexOf(old_str, idx + old_str.length)
      if (second !== -1) {
        throw new Error(`old_str matches in multiple locations in "${repoPath}" — include more surrounding context to make it unique`)
      }
      const next = existing.content.slice(0, idx) + (new_str || '') + existing.content.slice(idx + old_str.length)
      // Same pre-commit syntax gate as writeFile — applies to surgical
      // edits too, since old_str / new_str can introduce just as much
      // breakage as a full overwrite (mismatched JSX braces being the
      // single most common offender).
      const lintError = syntaxLintBeforeCommit(repoPath, next)
      if (lintError) throw new Error(lintError)
      const result = await putFile(
        repoPath,
        next,
        message || `Auroraly agent: edit ${repoPath}`,
        existing.sha
      )
      return `Edited ${repoPath} on ${repo}@${branch} (${result.sha?.slice(0, 7)}). Replaced 1 occurrence (${old_str.length} → ${(new_str || '').length} bytes). Vercel will redeploy automatically.`
    },

    /**
     * Delete a file from the GitHub repo. Used by the v2 agent's
     * `delete_file` tool when the AI needs to physically remove a
     * file (e.g. an outdated component that's been superseded).
     * Returns a no-op success message if the file is already gone —
     * deletes are idempotent.
     */
    async deleteFile(repoPath, message) {
      const existing = await getFile(repoPath)
      if (!existing) {
        return `${repoPath} was not present on ${repo}@${branch} (already deleted or never existed).`
      }
      const result = await deleteFileOnGithub(
        repoPath,
        message || `Auroraly agent: delete ${repoPath}`,
        existing.sha,
      )
      return `Deleted ${repoPath} on ${repo}@${branch} (${result.sha?.slice(0, 7)}). Vercel will redeploy automatically.${result.url ? ' ' + result.url : ''}`
    },
  }
}

/** Returns a tool-shaped writer object that ALWAYS errors with setup
 *  instructions — used when we're on a non-persistent filesystem but
 *  GITHUB_TOKEN / GITHUB_REPO are not configured. */
export function buildMissingConfigWriter(missing) {
  const msg = `Cannot write files in this environment because the GitHub writer is not configured. Set these env vars on the deployment: ${missing.join(', ')}. (GITHUB_TOKEN must be a fine-grained PAT with Contents:write on the repo.) Once set, file edits will be committed to GitHub and Vercel will auto-redeploy.`
  return {
    isConfigured: false,
    async writeFile() { throw new Error(msg) },
    async editFile() { throw new Error(msg) },
    async deleteFile() { throw new Error(msg) },
  }
}

/**
 * Build a configured GitHub reader. Mirrors the writer but provides
 * readFile / listFiles / searchFiles. Returns null if required env
 * vars are missing.
 *
 * On a serverless deployment, the Lambda bundle does NOT contain the
 * source tree — Next.js tree-shakes it. So we MUST read from GitHub
 * to give the agent visibility of the real codebase it's editing.
 */
export function buildGithubReader(opts = {}) {
  const token = opts.token ?? process.env.GITHUB_TOKEN
  const repo = opts.repo ?? process.env.GITHUB_REPO
  const branch = opts.branch ?? process.env.GITHUB_BRANCH ?? DEFAULT_BRANCH
  const fetchImpl = opts.fetch ?? globalThis.fetch

  if (!token || !repo) return null
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error(`GITHUB_REPO must be in "owner/name" format, got: ${repo}`)
  }

  const baseHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'auroraly-agent-v2',
  }

  let cachedTree = null
  let cachedTreeAt = 0
  const TREE_CACHE_MS = 30_000

  async function getTree() {
    const now = Date.now()
    if (cachedTree && now - cachedTreeAt < TREE_CACHE_MS) return cachedTree
    const url = `${GITHUB_API}/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    const res = await fetchImpl(url, { headers: baseHeaders })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub GET tree failed (${res.status}): ${body.slice(0, 300)}`)
    }
    const json = await res.json()
    cachedTree = (json.tree || []).filter((node) => node.type === 'blob').map((node) => node.path)
    cachedTreeAt = now
    return cachedTree
  }

  function matchesGlob(filePath, pattern) {
    // Convert a simple glob (*.js, *foo*, name.ext) into a regex.
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const re = new RegExp('^' + escaped + '$')
    const baseName = filePath.split('/').pop()
    return re.test(baseName) || re.test(filePath)
  }

  return {
    isConfigured: true,
    repo,
    branch,

    /** Read a file from the GitHub repo, return content with line numbers. */
    async readFile(repoPath, maxBytes = 200 * 1024) {
      const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(repoPath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`
      const res = await fetchImpl(url, { headers: baseHeaders })
      if (res.status === 404) throw new Error(`"${repoPath}" not found on ${repo}@${branch}`)
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`GitHub GET ${repoPath} failed (${res.status}): ${body.slice(0, 300)}`)
      }
      const json = await res.json()
      if (Array.isArray(json)) {
        throw new Error(`"${repoPath}" is a directory, not a file`)
      }
      const buf = Buffer.from(json.content || '', json.encoding || 'base64')
      const raw = buf.toString('utf-8')
      const truncated = raw.length > maxBytes
      const content = truncated ? raw.slice(0, maxBytes) + `\n[truncated at ${maxBytes} bytes]` : raw
      const lineCount = raw.split('\n').length
      // Caller does line-numbering — we just return raw + meta
      return { content, lineCount, truncated, source: `${repo}@${branch}/${repoPath}` }
    },

    /** List files matching a name pattern, using the cached repo tree. */
    async listFiles(name_pattern, basePath) {
      const tree = await getTree()
      const matches = tree.filter((p) => {
        if (basePath && !p.startsWith(basePath.replace(/^\/+/, ''))) return false
        return matchesGlob(p, name_pattern)
      })
      return matches.slice(0, 50)
    },

    /** Search file contents via GitHub Code Search API. */
    async searchFiles(pattern, basePath) {
      const q = encodeURIComponent(`${pattern} repo:${repo}${basePath ? ` path:${basePath.replace(/^\/+/, '')}` : ''}`)
      const url = `${GITHUB_API}/search/code?q=${q}&per_page=30`
      const res = await fetchImpl(url, { headers: baseHeaders })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`GitHub search failed (${res.status}): ${body.slice(0, 300)}`)
      }
      const json = await res.json()
      const items = (json.items || []).slice(0, 30)
      if (items.length === 0) return `(no matches for "${pattern}" in ${repo}@${branch})`
      return items.map((it) => `${it.path} — ${it.html_url}`).join('\n')
    },
  }
}
