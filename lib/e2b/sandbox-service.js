/**
 * E2B Sandbox Service — Gives Emanator's AI a real computer
 * 
 * Provides sandboxed execution environment where the AI can:
 * - Read/write files on a real filesystem
 * - Execute shell commands (npm install, npm run build, etc.)
 * - Run and test code in isolation
 * - Verify compilation before saving
 * 
 * Each project gets its own sandbox that persists for the session.
 */

import { Sandbox } from 'e2b'

// Active sandboxes keyed by project ID
const activeSandboxes = new Map()

// Default sandbox timeout: 5 minutes of inactivity
const SANDBOX_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Get or create a sandbox for a project.
 * Reuses existing sandbox if still alive.
 */
export async function getOrCreateSandbox(projectId) {
  const existing = activeSandboxes.get(projectId)
  if (existing) {
    try {
      // Check if still alive by running a quick command
      await existing.sandbox.commands.run('echo ok', { timeoutMs: 3000 })
      existing.lastAccess = Date.now()
      return existing.sandbox
    } catch {
      // Sandbox died — remove and create new
      activeSandboxes.delete(projectId)
    }
  }

  console.log(`[E2B] Creating sandbox for project ${projectId}`)
  const sandbox = await Sandbox.create({
    timeoutMs: SANDBOX_TIMEOUT_MS,
  })

  activeSandboxes.set(projectId, {
    sandbox,
    projectId,
    createdAt: Date.now(),
    lastAccess: Date.now(),
  })

  // Set up workspace with Node.js project scaffold
  await sandbox.commands.run('mkdir -p /home/user/project', { timeoutMs: 5000 })

  // Pre-install common dependencies in background for faster builds
  sandbox.commands.run(
    'cd /home/user/project && npm init -y --silent 2>/dev/null && npm install --save react react-dom next tailwindcss 2>/dev/null',
    { timeoutMs: 120000 }
  ).catch(err => {
    console.warn(`[E2B] Background dep install failed (non-blocking): ${err.message}`)
  })

  console.log(`[E2B] Sandbox created: ${sandbox.sandboxId} for project ${projectId}`)
  return sandbox
}

/**
 * Write project files into the sandbox filesystem.
 * Called before the AI starts editing.
 */
export async function syncFilesToSandbox(sandbox, files) {
  let written = 0
  for (const file of files) {
    if (!file.path || !file.content) continue
    const sandboxPath = `/home/user/project/${file.path}`
    // Ensure directory exists
    const dir = sandboxPath.split('/').slice(0, -1).join('/')
    await sandbox.commands.run(`mkdir -p "${dir}"`, { timeoutMs: 3000 })
    await sandbox.files.write(sandboxPath, file.content)
    written++
  }
  console.log(`[E2B] Synced ${written} files to sandbox`)
  return written
}

/**
 * Read a file from the sandbox.
 */
export async function readSandboxFile(sandbox, filePath) {
  const sandboxPath = `/home/user/project/${filePath}`
  try {
    const content = await sandbox.files.read(sandboxPath)
    return { success: true, content, path: filePath }
  } catch (err) {
    return { success: false, error: err.message, path: filePath }
  }
}

/**
 * Read multiple files from the sandbox.
 */
export async function readSandboxFiles(sandbox, filePaths) {
  const results = []
  for (const fp of filePaths.slice(0, 10)) { // Max 10 files
    results.push(await readSandboxFile(sandbox, fp))
  }
  return results
}

/**
 * Write a file to the sandbox.
 */
export async function writeSandboxFile(sandbox, filePath, content) {
  const sandboxPath = `/home/user/project/${filePath}`
  const dir = sandboxPath.split('/').slice(0, -1).join('/')
  await sandbox.commands.run(`mkdir -p "${dir}"`, { timeoutMs: 3000 })
  await sandbox.files.write(sandboxPath, content)
  return { success: true, path: filePath }
}

/**
 * Execute a shell command in the sandbox.
 */
export async function execInSandbox(sandbox, command, opts = {}) {
  const cwd = opts.cwd || '/home/user/project'
  const timeoutMs = opts.timeoutMs || 60000 // 1 min default
  
  try {
    const result = await sandbox.commands.run(command, {
      cwd,
      timeoutMs,
    })
    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    }
  } catch (err) {
    return {
      success: false,
      exitCode: -1,
      stdout: '',
      stderr: err.message,
    }
  }
}

/**
 * Install dependencies in the sandbox.
 */
export async function installDependencies(sandbox) {
  console.log('[E2B] Installing dependencies...')
  const result = await execInSandbox(sandbox, 'npm install --prefer-offline --no-audit 2>&1', { timeoutMs: 120000 })
  console.log(`[E2B] npm install: exitCode=${result.exitCode}`)
  return result
}

/**
 * Run build and check for compilation errors.
 * Returns structured result with errors parsed.
 */
export async function verifyBuild(sandbox) {
  console.log('[E2B] Verifying build...')
  const result = await execInSandbox(sandbox, 'npm run build 2>&1', { timeoutMs: 120000 })
  
  const errors = []
  const combined = result.stdout + '\n' + result.stderr
  
  // Parse common build errors
  const errorLines = combined.split('\n').filter(line => 
    line.includes('Error:') || line.includes('error TS') || line.includes('SyntaxError') || 
    line.includes('Module not found') || line.includes('Cannot find')
  )
  
  for (const line of errorLines.slice(0, 10)) { // Max 10 errors
    errors.push(line.trim())
  }
  
  return {
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    errors,
    output: combined.slice(-2000), // Last 2K chars of output
  }
}

/**
 * Run tests in the sandbox.
 */
export async function runTests(sandbox, testCommand = 'npm test') {
  console.log('[E2B] Running tests...')
  const result = await execInSandbox(sandbox, `${testCommand} 2>&1`, { timeoutMs: 120000 })
  return {
    success: result.exitCode === 0,
    output: (result.stdout + '\n' + result.stderr).slice(-3000),
  }
}

/**
 * List files in the sandbox project directory.
 */
export async function listSandboxFiles(sandbox, dir = '') {
  const sandboxDir = `/home/user/project/${dir}`
  const result = await execInSandbox(sandbox, `find "${sandboxDir}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | head -100`, { timeoutMs: 5000 })
  if (!result.success) return []
  
  return result.stdout.split('\n').filter(Boolean).map(p => 
    p.replace('/home/user/project/', '')
  )
}

/**
 * Kill a project's sandbox.
 */
export async function killSandbox(projectId) {
  const entry = activeSandboxes.get(projectId)
  if (!entry) return
  
  try {
    await entry.sandbox.kill()
    console.log(`[E2B] Killed sandbox for project ${projectId}`)
  } catch {
    // Already dead
  }
  activeSandboxes.delete(projectId)
}

/**
 * Get sandbox info.
 */
export function getSandboxInfo(projectId) {
  const entry = activeSandboxes.get(projectId)
  if (!entry) return null
  return {
    sandboxId: entry.sandbox.sandboxId,
    projectId: entry.projectId,
    createdAt: entry.createdAt,
    lastAccess: entry.lastAccess,
    alive: true,
  }
}

/**
 * Cleanup stale sandboxes (call periodically).
 */
export async function cleanupStaleSandboxes(maxIdleMs = 10 * 60 * 1000) {
  const now = Date.now()
  for (const [projectId, entry] of activeSandboxes) {
    if (now - entry.lastAccess > maxIdleMs) {
      await killSandbox(projectId)
    }
  }
}
