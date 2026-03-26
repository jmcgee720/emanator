/**
 * Safe Apply — atomic diff application with rollback protection.
 * Enforces owner-only self-edit, manages diffStatus transitions,
 * guarantees atomic apply (no partial writes), supports rollback.
 */

const { db } = require('../supabase/db')

// ── Inline constants (avoids ESM/CJS cross-import issues) ──
const SELF_EDIT_PREFIX = '⚙ Self-Edit: '
const ROLE_OWNER = 'owner'

// ── Auth helpers ──

/**
 * Determine if a chat is a self-edit chat by querying its title.
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
async function isSelfEditChat(chatId) {
  if (!chatId) return false
  try {
    const chat = await db.chats.findById(chatId)
    return chat?.title?.startsWith(SELF_EDIT_PREFIX) || false
  } catch {
    return false
  }
}

/**
 * Verify a userId maps to an owner-role user.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isOwner(userId) {
  if (!userId) return false
  try {
    const user = await db.users.findById(userId)
    return user?.role === ROLE_OWNER
  } catch {
    return false
  }
}

// ── Diff-status helpers ──

/**
 * Find the most recent message whose metadata has diffStatus='pending'.
 * @param {string} chatId
 * @returns {Promise<object|null>}
 */
async function findPendingDiffMessage(chatId) {
  if (!chatId) return null
  try {
    const messages = await db.messages.findByChatId(chatId)
    return messages.reverse().find(m =>
      m.metadata?.diffStatus === 'pending' && m.metadata?.diffFiles?.length > 0
    ) || null
  } catch {
    return null
  }
}

/**
 * Transition diffStatus on a single message.
 * @param {string} messageId
 * @param {'applied'|'discarded'} newStatus
 */
async function transitionDiffStatus(messageId, newStatus) {
  if (!messageId) return
  const msg = await db.messages.findById(messageId)
  if (!msg) return
  const current = msg.metadata?.diffStatus
  if (current !== 'pending') {
    throw new Error(`Cannot transition diffStatus from "${current}" to "${newStatus}" — expected "pending"`)
  }
  await db.messages.update(messageId, {
    metadata: { ...(msg.metadata || {}), diffStatus: newStatus, diffTransitionedAt: new Date().toISOString() }
  })
}

// ── Snapshot / Rollback ──

/**
 * Snapshot the current state of every file that a diff set will touch.
 * Returns Map<normalizedPath, { id, content, file_type, version } | null>.
 * null = file does not exist yet.
 * @param {string} projectId
 * @param {object[]} diffs
 * @returns {Promise<Map>}
 */
async function snapshotAffectedFiles(projectId, diffs) {
  const snapshot = new Map()
  for (const diff of diffs) {
    const norm = (diff.path || '').replace(/^\.\//, '').replace(/^\//, '')
    try {
      const existing = await db.projectFiles.findByPath(projectId, norm)
      snapshot.set(norm, existing ? {
        id: existing.id,
        content: existing.content,
        file_type: existing.file_type,
        version: existing.version,
      } : null)
    } catch {
      snapshot.set(norm, null)
    }
  }
  return snapshot
}

/**
 * Pre-validate every diff before any writes begin.
 * @param {object[]} diffs
 * @param {Map} snapshot — from snapshotAffectedFiles
 * @returns {string[]} — error strings; empty = all valid
 */
function preValidateDiffs(diffs, snapshot) {
  const errors = []
  const seenPaths = new Set()

  for (const diff of diffs) {
    const norm = (diff.path || '').replace(/^\.\//, '').replace(/^\//, '')

    if (!norm) {
      errors.push('Empty file path in diff entry')
      continue
    }

    if (seenPaths.has(norm)) {
      errors.push(`${norm}: duplicate path in diff set`)
    }
    seenPaths.add(norm)

    if (diff.action !== 'delete' && (diff.newContent === null || diff.newContent === undefined)) {
      errors.push(`${norm}: ${diff.action || 'create'} requires newContent`)
    }

    if (diff.action === 'delete') {
      const existing = snapshot.get(norm)
      if (existing === null || existing === undefined) {
        errors.push(`${norm}: delete targets non-existent file`)
      }
    }
  }

  return errors
}

/**
 * Rollback every applied path to its pre-apply snapshot state.
 * @param {string} projectId
 * @param {Map} snapshot
 * @param {string[]} appliedPaths — paths that were successfully written
 * @returns {Promise<{restored:string[], deleted:string[], failed:{path:string,error:string}[]}>}
 */
async function rollback(projectId, snapshot, appliedPaths) {
  const details = { restored: [], deleted: [], failed: [] }

  for (const path of appliedPaths) {
    const original = snapshot.get(path)
    try {
      if (original === null) {
        // File did not exist before — remove the one we created
        const created = await db.projectFiles.findByPath(projectId, path)
        if (created) {
          await db.projectFiles.delete(created.id)
          details.deleted.push(path)
        }
      } else if (original) {
        // File existed — restore its content + version
        await db.projectFiles.update(original.id, {
          content: original.content,
          version: original.version,
        })
        details.restored.push(path)
      }
    } catch (rbErr) {
      console.error(`[safeApply] Rollback failed for ${path}:`, rbErr.message)
      details.failed.push({ path, error: rbErr.message })
    }
  }

  return details
}

// ── Core Apply ──

/**
 * Apply diffs atomically. If any single write fails every preceding
 * change is rolled back so the project is never left in a partial state.
 *
 * @param {string} projectId
 * @param {object[]} diffs — from file_ops_bridge.buildPendingDiffs or approvedFiles
 *   Each: { path, action, newContent, oldContent?, description?, fileType? }
 * @param {function} detectFileType — (path) => string
 * @param {object} [opts]
 * @param {string} [opts.chatId]     — self-edit gate + diffStatus lookup
 * @param {string} [opts.userId]     — owner verification for self-edit
 * @param {string} [opts.messageId]  — explicit pending-diff message id
 * @returns {Promise<{written:string[], deleted:string[], errors:string[],
 *           rolledBack:boolean, rollbackDetails:object|null,
 *           diffStatusTransitioned:string|null}>}
 */
async function safeApplyDiffs(projectId, diffs, detectFileType, opts = {}) {
  const { chatId, userId, messageId } = opts
  const result = {
    written: [],
    deleted: [],
    errors: [],
    rolledBack: false,
    rollbackDetails: null,
    diffStatusTransitioned: null,
  }

  if (!diffs || diffs.length === 0) return result

  // ── 0. Owner-only self-edit gate ──
  if (chatId) {
    const selfEdit = await isSelfEditChat(chatId)
    if (selfEdit) {
      const ownerOk = await isOwner(userId)
      if (!ownerOk) {
        result.errors.push('FORBIDDEN: self-edit apply requires owner role')
        return result
      }
    }
  }

  // ── 1. Snapshot ──
  const snapshot = await snapshotAffectedFiles(projectId, diffs)

  // ── 2. Pre-validate (catch problems before any writes) ──
  const validationErrors = preValidateDiffs(diffs, snapshot)
  if (validationErrors.length > 0) {
    result.errors = validationErrors
    return result
  }

  const appliedPaths = []

  // ── 3. Sequential writes — abort + rollback on first failure ──
  for (const diff of diffs) {
    const norm = (diff.path || '').replace(/^\.\//, '').replace(/^\//, '')
    try {
      if (diff.action === 'delete') {
        const existing = await db.projectFiles.findByPath(projectId, norm)
        if (existing) {
          await db.fileChangeEvents.create({
            project_id: projectId, file_id: existing.id, file_path: norm,
            action: 'delete', changes: diff.description || 'Deleted via safe apply',
          })
          await db.projectFiles.delete(existing.id)
          appliedPaths.push(norm)
          result.deleted.push(norm)
        }
      } else if (diff.action === 'update') {
        const existing = await db.projectFiles.findByPath(projectId, norm)
        if (existing) {
          await db.projectFiles.update(existing.id, {
            content: diff.newContent,
            version: existing.version + 1,
            change_source: 'safe_apply',
          })
          await db.fileChangeEvents.create({
            project_id: projectId, file_id: existing.id, file_path: norm,
            action: 'update', changes: diff.description || 'Updated via safe apply',
          })
          appliedPaths.push(norm)
          result.written.push(norm)
        } else {
          // Plan said update but file missing — auto-create
          const newFile = await db.projectFiles.create({
            project_id: projectId, path: norm,
            content: diff.newContent,
            file_type: diff.fileType || detectFileType(norm),
            version: 1, change_source: 'safe_apply',
          })
          await db.fileChangeEvents.create({
            project_id: projectId, file_id: newFile.id, file_path: norm,
            action: 'create', changes: diff.description || 'Auto-created (plan said update, file missing)',
          })
          appliedPaths.push(norm)
          result.written.push(norm)
        }
            } else {
        // create (default) — if file already exists, update instead of failing
        const existing = await db.projectFiles.findByPath(projectId, norm)

        if (existing) {
          await db.projectFiles.update(existing.id, {
            content: diff.newContent,
            version: existing.version + 1,
            change_source: 'safe_apply',
          })

          await db.fileChangeEvents.create({
            project_id: projectId,
            file_id: existing.id,
            file_path: norm,
            action: 'update',
            changes: diff.description || 'Updated via safe apply (existing file)',
          })
        } else {
          const newFile = await db.projectFiles.create({
            project_id: projectId,
            path: norm,
            content: diff.newContent,
            file_type: diff.fileType || detectFileType(norm),
            version: 1,
            change_source: 'safe_apply',
          })

          await db.fileChangeEvents.create({
            project_id: projectId,
            file_id: newFile.id,
            file_path: norm,
            action: 'create',
            changes: diff.description || 'Created via safe apply',
          })
        }

        appliedPaths.push(norm)
        result.written.push(norm)
      }
    } catch (err) {
      console.error(`[safeApply] Failed on ${norm}:`, err.message)
      result.errors.push(`${norm}: ${err.message}`)

      // Rollback everything applied so far
      console.log(`[safeApply] Rolling back ${appliedPaths.length} applied change(s)…`)
      const rollbackDetails = await rollback(projectId, snapshot, appliedPaths)
      result.rolledBack = true
      result.rollbackDetails = rollbackDetails
      result.written = []
      result.deleted = []

      // diffStatus stays 'pending' — no transition on failure
      return result
    }
  }

  // ── 4. All writes succeeded — transition diffStatus → 'applied' ──
  const targetMessageId = messageId || (chatId ? (await findPendingDiffMessage(chatId))?.id : null)
  if (targetMessageId) {
    try {
      await transitionDiffStatus(targetMessageId, 'applied')
      result.diffStatusTransitioned = 'applied'
    } catch (statusErr) {
      console.error('[safeApply] diffStatus transition failed:', statusErr.message)
      // File writes succeeded — do NOT rollback for metadata-only failure
      result.errors.push(`diffStatus transition failed: ${statusErr.message}`)
    }
  }

  return result
}

// ── Discard ──

/**
 * Discard pending diffs. Transitions diffStatus to 'discarded'
 * without touching any project files.
 *
 * @param {string} chatId
 * @param {string} [messageId] — explicit message to discard
 * @param {string} [userId]    — for self-edit ownership check
 * @returns {Promise<{discarded:boolean, error?:string, diffStatusTransitioned?:string}>}
 */
async function discardDiffs(chatId, messageId, userId) {
  if (!chatId && !messageId) {
    return { discarded: false, error: 'No chatId or messageId provided' }
  }

  // Owner-only self-edit gate
  if (chatId) {
    const selfEdit = await isSelfEditChat(chatId)
    if (selfEdit) {
      const ownerOk = await isOwner(userId)
      if (!ownerOk) {
        return { discarded: false, error: 'FORBIDDEN: self-edit discard requires owner role' }
      }
    }
  }

  const targetId = messageId || (await findPendingDiffMessage(chatId))?.id
  if (!targetId) {
    return { discarded: false, error: 'No pending diff message found' }
  }

  try {
    await transitionDiffStatus(targetId, 'discarded')
    return { discarded: true, diffStatusTransitioned: 'discarded' }
  } catch (err) {
    return { discarded: false, error: err.message }
  }
}

module.exports = {
  safeApplyDiffs,
  discardDiffs,
  snapshotAffectedFiles,
  rollback,
  preValidateDiffs,
  findPendingDiffMessage,
  transitionDiffStatus,
  isSelfEditChat,
  isOwner,
}
