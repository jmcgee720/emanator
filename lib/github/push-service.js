/**
 * GitHub Push Service
 *
 * Pushes a project's files to a GitHub repository using the GitHub REST API
 * (no git CLI needed — works in serverless functions). Creates the repo on
 * first push if it doesn't exist, then commits all files atomically via the
 * Git Data API: blobs → tree → commit → ref.
 *
 * Token: caller passes a Classic GitHub PAT with `repo` scope. We don't
 * persist it here — caller decides whether to store it in project.settings.
 *
 * NOTE: GitHub's REST blob upload accepts up to 100MB per blob; we don't
 * batch beyond what node fetch can handle in one function call. For typical
 * Auroraly projects (4-12 files at <100KB each) this is comfortable.
 */

const GH_API = 'https://api.github.com'

function ghHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'auroraly-push',
  }
}

async function ghFetch(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...ghHeaders(token), ...(init.headers || {}), 'Content-Type': 'application/json' },
  })
  if (res.status === 204) return null
  let body = null
  try { body = await res.json() } catch { /* empty */ }
  if (!res.ok) {
    const msg = body?.message || `GitHub API ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    err.detail = body
    throw err
  }
  return body
}

/**
 * Get the authenticated user's GitHub login (e.g. "jmcgee720"). Used so the
 * caller doesn't have to specify the owner — we always push to repos owned
 * by the PAT's user.
 */
async function getAuthedLogin(token) {
  const me = await ghFetch(token, `${GH_API}/user`)
  return me.login
}

/**
 * Ensure a repo exists. Returns { owner, repo, default_branch, is_new }.
 * Creates a private/public repo if not found.
 */
async function ensureRepo(token, repoName, isPrivate, description) {
  const owner = await getAuthedLogin(token)
  // Check if repo exists
  try {
    const repo = await ghFetch(token, `${GH_API}/repos/${owner}/${repoName}`)
    return { owner, repo: repoName, default_branch: repo.default_branch || 'main', is_new: false }
  } catch (err) {
    if (err.status !== 404) throw err
  }
  // Create new repo
  const created = await ghFetch(token, `${GH_API}/user/repos`, {
    method: 'POST',
    body: JSON.stringify({
      name: repoName,
      private: !!isPrivate,
      auto_init: true, // creates initial main branch with README so we have a SHA to commit on
      description: description || 'Built with Auroraly',
    }),
  })
  return { owner, repo: repoName, default_branch: created.default_branch || 'main', is_new: true }
}

/**
 * Get the current head SHA + tree SHA of the default branch.
 */
async function getHeadCommit(token, owner, repo, branch) {
  const ref = await ghFetch(token, `${GH_API}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`)
  const commitSha = ref.object.sha
  const commit = await ghFetch(token, `${GH_API}/repos/${owner}/${repo}/git/commits/${commitSha}`)
  return { commitSha, treeSha: commit.tree.sha }
}

/**
 * Create a blob for a file's content. Returns the blob SHA. Binary content
 * (e.g. base64 PNGs) is sent with encoding=base64; text uses utf-8.
 */
async function createBlob(token, owner, repo, content) {
  // Heuristic: if content is a data URL or already base64-ish, send as base64.
  const isBase64Like = typeof content === 'string' && content.startsWith('data:') && content.includes(';base64,')
  let payload
  if (isBase64Like) {
    payload = { content: content.split(';base64,')[1], encoding: 'base64' }
  } else {
    payload = { content: String(content), encoding: 'utf-8' }
  }
  const blob = await ghFetch(token, `${GH_API}/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return blob.sha
}

/**
 * Push all files to a repo as a single commit on the default branch.
 *
 * @param {object} args
 * @param {string} args.token        - GitHub PAT
 * @param {string} args.repoName     - desired repo name (under the PAT's user)
 * @param {boolean} args.isPrivate   - private repo? (only used on first creation)
 * @param {string} args.description
 * @param {Array<{path:string,content:string}>} args.files
 * @param {string} args.commitMessage
 *
 * @returns {object} { repo_url, html_url, commit_sha, file_count, was_new_repo }
 */
export async function pushProjectToGithub({ token, repoName, isPrivate = true, description = '', files, commitMessage = 'Update from Auroraly' }) {
  if (!token) throw new Error('GitHub token is required')
  if (!repoName) throw new Error('Repo name is required')
  if (!Array.isArray(files) || files.length === 0) throw new Error('No files to push')

  const { owner, repo, default_branch, is_new } = await ensureRepo(token, repoName, isPrivate, description)

  // Always fetch current head — auto_init guarantees it exists for new repos
  const { commitSha: parentSha, treeSha: baseTreeSha } = await getHeadCommit(token, owner, repo, default_branch)

  // Create blobs in parallel for speed (GitHub allows ~5000 req/h with auth)
  const blobs = await Promise.all(files.map(async (f) => {
    const sha = await createBlob(token, owner, repo, f.content || '')
    return { path: f.path, mode: '100644', type: 'blob', sha }
  }))

  // Create the new tree based on the existing tree (so we keep README from auto_init)
  const tree = await ghFetch(token, `${GH_API}/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: blobs }),
  })

  // Create the commit
  const commit = await ghFetch(token, `${GH_API}/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: commitMessage, tree: tree.sha, parents: [parentSha] }),
  })

  // Update the branch ref to the new commit
  await ghFetch(token, `${GH_API}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(default_branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  })

  return {
    owner,
    repo,
    repo_url: `https://github.com/${owner}/${repo}`,
    html_url: `https://github.com/${owner}/${repo}/tree/${default_branch}`,
    commit_sha: commit.sha,
    commit_url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    file_count: files.length,
    was_new_repo: is_new,
    branch: default_branch,
  }
}

/**
 * Validate a GitHub PAT — checks it can read the user info. Returns the
 * login on success, throws on failure. Used so we can fail fast in the UI
 * with a friendly message instead of mid-push.
 */
export async function validateGithubToken(token) {
  if (!token) throw new Error('Token required')
  const me = await ghFetch(token, `${GH_API}/user`)
  return { login: me.login, name: me.name, avatar_url: me.avatar_url }
}
