// ══════════════════════════════════════════════════════════════════════
// ── SELF-EDIT SNAPSHOT ──
// Extracted from message-stream.js (duplicated verbatim between the
// `search_replace` and `edit_lines` tool branches). Creates a
// timestamped backup copy of any file in the /app/.emanator-backups
// directory before a self-edit modifies it, keeping the 20 most recent
// backups per path so we can rollback if something goes wrong.
//
// Best-effort: any filesystem failure is caught and warned; the caller
// is never interrupted.
// ══════════════════════════════════════════════════════════════════════

import fs from 'fs'
import path from 'path'

const BACKUP_DIR = '/app/.emanator-backups'
const MAX_BACKUPS_PER_PATH = 20

/**
 * Copy the given source-file to the backup dir (timestamped name) and
 * prune older backups for the same path beyond `MAX_BACKUPS_PER_PATH`.
 *
 * @param {string} relPath - relative to /app (e.g. "components/x.jsx")
 * @param {string} [label='self-edit'] - log prefix, purely cosmetic
 * @returns {{saved: boolean, name?: string, reason?: string}}
 */
export function snapshotSelfEditFile(relPath, label = 'self-edit') {
  try {
    if (!relPath || typeof relPath !== 'string') {
      return { saved: false, reason: 'missing-path' }
    }
    const fullPath = path.resolve('/app', relPath)
    if (!fs.existsSync(fullPath)) {
      return { saved: false, reason: 'source-missing' }
    }
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = relPath.replace(/\//g, '__') + '.' + timestamp
    fs.copyFileSync(fullPath, path.join(BACKUP_DIR, backupName))

    // Prune older backups for this same source path.
    const prefix = relPath.replace(/\//g, '__')
    const siblings = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(prefix)).sort()
    if (siblings.length > MAX_BACKUPS_PER_PATH) {
      for (const old of siblings.slice(0, siblings.length - MAX_BACKUPS_PER_PATH)) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, old)) } catch { /* ignore */ }
      }
    }

    console.log(`[${label}] Snapshot saved: ${backupName}`)
    return { saved: true, name: backupName }
  } catch (err) {
    console.warn(`[${label}] Snapshot failed: ${err.message}`)
    return { saved: false, reason: err.message }
  }
}
