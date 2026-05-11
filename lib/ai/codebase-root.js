// ── Codebase Root Detection ──
//
// Auto-detects where Auroraly's source tree lives at runtime so the v2
// self-edit agent can read the right files in any environment:
//
//   • Emergent sandbox / local dev:   /app   (mounted by Docker/supervisor)
//   • Vercel serverless function:      /var/task (or whatever process.cwd() is)
//   • Other deployments:               process.cwd() fallback
//
// We also report whether writes to the filesystem are persistent. On Vercel,
// /var/task is read-only and /tmp is ephemeral — so writes must be routed
// through a remote writer (GitHub Contents API) instead.

import fs from 'node:fs'
import path from 'node:path'

const MARKER_FILES = ['package.json', 'next.config.js', 'next.config.mjs']

function looksLikeAuroralyRoot(dir) {
  if (!dir) return false
  for (const marker of MARKER_FILES) {
    try {
      if (fs.existsSync(path.join(dir, marker))) return true
    } catch {}
  }
  return false
}

/**
 * Return the codebase root + a persistence flag.
 * @returns {{ root: string, isPersistent: boolean, source: string }}
 */
export function detectCodebaseRoot() {
  // 1. Explicit override (env var) — always wins
  const explicit = process.env.AURORALY_CODEBASE_ROOT
  if (explicit && looksLikeAuroralyRoot(explicit)) {
    return { root: explicit, isPersistent: detectPersistence(explicit), source: 'env:AURORALY_CODEBASE_ROOT' }
  }

  // 2. /app (Emergent sandbox / local dev with Docker)
  if (looksLikeAuroralyRoot('/app')) {
    return { root: '/app', isPersistent: detectPersistence('/app'), source: '/app' }
  }

  // 3. process.cwd() fallback (Vercel, other serverless)
  const cwd = process.cwd()
  if (looksLikeAuroralyRoot(cwd)) {
    return { root: cwd, isPersistent: detectPersistence(cwd), source: 'process.cwd()' }
  }

  // 4. Last resort: cwd even if it doesn't look like Auroraly
  return { root: cwd, isPersistent: false, source: 'process.cwd()-fallback' }
}

/**
 * Detect whether writes to a directory will survive request boundaries.
 *
 * Vercel/serverless filesystems are read-only OR ephemeral. We probe by
 * attempting to create + delete a tiny marker file. If it works, we
 * additionally check for the well-known Vercel marker (/.vercel) which
 * indicates a serverless function bundle even when /tmp is writable.
 */
function detectPersistence(dir) {
  // Hard signal: Vercel sets these env vars in its build + runtime
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false
  // /var/task is the canonical Vercel/Lambda read-only bundle dir
  if (dir.startsWith('/var/task')) return false
  // Probe: try writing a temp file inside the dir
  try {
    const probe = path.join(dir, '.auroraly-write-probe-' + Date.now())
    fs.writeFileSync(probe, 'x')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}
