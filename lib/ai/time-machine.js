/**
 * Time Machine — Auto-snapshot & revert for Core System self-edit safety.
 * 
 * PROBLEM: Core System occasionally breaks itself (priorMessages outage,
 * vision pipeline broken, etc.). When that happens, you need Emerge to fix
 * it, but Emerge doesn't know what the "last known good" state was.
 * 
 * SOLUTION: Auto-snapshot the Auroraly source tree every N commits. Store
 * snapshots in the `snapshots` table with metadata (commit hash, timestamp,
 * file count). Provide a revert tool that restores all files from a snapshot.
 * 
 * USAGE:
 *   • Auto-snapshot: triggered by github-writer.js after every 5 commits
 *   • Manual snapshot: Core System calls create_snapshot tool
 *   • Revert: you (the owner) call revert_to_snapshot with a snapshot ID
 *   • List: list_snapshots shows recent snapshots with metadata
 * 
 * SAFEGUARDS:
 *   • Snapshots are immutable — once created, they can't be edited
 *   • Revert requires explicit confirmation (protected action)
 *   • Snapshots are scoped to the Core System project (project_id = 'auroraly-core')
 *   • Max 50 snapshots per project (auto-prune oldest when limit hit)
 */

import { db } from '@/lib/supabase/db'
import { buildGithubReader, buildGithubWriter } from '@/lib/ai/github-writer'

const CORE_PROJECT_ID = 'auroraly-core'
const MAX_SNAPSHOTS = 50
const AUTO_SNAPSHOT_INTERVAL = 5 // commits

let commitsSinceLastSnapshot = 0

/**
 * Create a snapshot of the current Auroraly source tree.
 * Reads all files from GitHub, stores them in the snapshots table.
 * Returns the snapshot ID and metadata.
 */
export async function createSnapshot(name = null, metadata = {}) {
  console.log('[TimeMachine] Creating snapshot:', name || 'auto')
  
  try {
    const reader = buildGithubReader()
    if (!reader) {
      throw new Error('GitHub reader not configured (missing GITHUB_TOKEN or GITHUB_REPO)')
    }
    
    // Read all files from the GitHub repo using the tree API
    const allFiles = await reader.listFiles('*')
    console.log('[TimeMachine] Found', allFiles.length, 'files in repo')
    
    // Read content for each file (in parallel, batched to avoid rate limits)
    const BATCH_SIZE = 10
    const filesSnapshot = []
    
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (filePath) => {
          try {
            const result = await reader.readFile(filePath)
            return {
              path: filePath,
              content: result.content,
              size: result.content.length,
            }
          } catch (err) {
            console.warn('[TimeMachine] Failed to read', filePath, ':', err.message)
            return null
          }
        })
      )
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          filesSnapshot.push(result.value)
        }
      }
    }
    
    console.log('[TimeMachine] Captured', filesSnapshot.length, 'files')
    
    // Get current commit hash from GitHub (if available)
    let commitHash = null
    try {
      const url = `https://api.github.com/repos/${reader.repo}/git/refs/heads/${reader.branch}`
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
        },
      })
      if (res.ok) {
        const json = await res.json()
        commitHash = json.object?.sha
      }
    } catch (err) {
      console.warn('[TimeMachine] Could not fetch commit hash:', err.message)
    }
    
    // Create snapshot in DB
    const snapshotName = name || `Auto-snapshot ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
    const snapshot = await db.snapshots.create({
      project_id: CORE_PROJECT_ID,
      name: snapshotName,
      files_snapshot: filesSnapshot,
      canvas_snapshot: null,
      metadata: {
        ...metadata,
        commit_hash: commitHash,
        file_count: filesSnapshot.length,
        total_size: filesSnapshot.reduce((sum, f) => sum + f.size, 0),
        created_by: 'time-machine',
        auto: !name,
      },
    })
    
    console.log('[TimeMachine] Snapshot created:', snapshot.id)
    
    // Prune old snapshots if we've hit the limit
    await pruneOldSnapshots()
    
    return {
      id: snapshot.id,
      name: snapshot.name,
      file_count: filesSnapshot.length,
      created_at: snapshot.created_at,
      commit_hash: commitHash,
    }
  } catch (err) {
    console.error('[TimeMachine] Snapshot creation failed:', err)
    throw new Error(`Failed to create snapshot: ${err.message}`)
  }
}

/**
 * List recent snapshots for the Core System project.
 * Returns snapshot metadata (ID, name, file count, timestamp).
 */
export async function listSnapshots(limit = 20) {
  try {
    const snapshots = await db.snapshots.findByProjectId(CORE_PROJECT_ID)
    
    return snapshots.slice(0, limit).map(s => ({
      id: s.id,
      name: s.name,
      file_count: s.metadata?.file_count || s.files_snapshot?.length || 0,
      total_size: s.metadata?.total_size || 0,
      commit_hash: s.metadata?.commit_hash || null,
      created_at: s.created_at,
      auto: s.metadata?.auto || false,
    }))
  } catch (err) {
    console.error('[TimeMachine] Failed to list snapshots:', err)
    throw new Error(`Failed to list snapshots: ${err.message}`)
  }
}

/**
 * Revert the Auroraly source tree to a snapshot.
 * Reads all files from the snapshot, writes them back to GitHub.
 * 
 * DANGER: This overwrites ALL files in the repo. Use with caution.
 * Requires explicit confirmation from the user.
 */
export async function revertToSnapshot(snapshotId, confirmed = false) {
  if (!confirmed) {
    throw new Error('Revert requires explicit confirmation. Set confirmed=true to proceed.')
  }
  
  console.log('[TimeMachine] Reverting to snapshot:', snapshotId)
  
  try {
    const writer = buildGithubWriter()
    if (!writer) {
      throw new Error('GitHub writer not configured (missing GITHUB_TOKEN or GITHUB_REPO)')
    }
    
    // Fetch the snapshot
    const snapshot = await db.snapshots.findById(snapshotId)
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`)
    }
    
    if (snapshot.project_id !== CORE_PROJECT_ID) {
      throw new Error(`Snapshot ${snapshotId} is not a Core System snapshot`)
    }
    
    const filesSnapshot = snapshot.files_snapshot || []
    if (filesSnapshot.length === 0) {
      throw new Error(`Snapshot ${snapshotId} has no files`)
    }
    
    console.log('[TimeMachine] Restoring', filesSnapshot.length, 'files from snapshot:', snapshot.name)
    
    // Write all files back to GitHub (in parallel, batched)
    const BATCH_SIZE = 5
    const results = []
    
    for (let i = 0; i < filesSnapshot.length; i += BATCH_SIZE) {
      const batch = filesSnapshot.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.allSettled(
        batch.map(async (file) => {
          try {
            await writer.writeFile(file.path, file.content, `[TimeMachine] Revert to snapshot: ${snapshot.name}`)
            return { path: file.path, success: true }
          } catch (err) {
            console.error('[TimeMachine] Failed to restore', file.path, ':', err.message)
            return { path: file.path, success: false, error: err.message }
          }
        })
      )
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value)
        }
      }
    }
    
    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length
    
    console.log('[TimeMachine] Revert complete:', successCount, 'files restored,', failCount, 'failed')
    
    return {
      snapshot_id: snapshotId,
      snapshot_name: snapshot.name,
      files_restored: successCount,
      files_failed: failCount,
      failed_files: results.filter(r => !r.success).map(r => ({ path: r.path, error: r.error })),
    }
  } catch (err) {
    console.error('[TimeMachine] Revert failed:', err)
    throw new Error(`Failed to revert to snapshot: ${err.message}`)
  }
}

/**
 * Prune old snapshots when we've hit the limit.
 * Keeps the most recent MAX_SNAPSHOTS, deletes the rest.
 */
async function pruneOldSnapshots() {
  try {
    const snapshots = await db.snapshots.findByProjectId(CORE_PROJECT_ID)
    
    if (snapshots.length <= MAX_SNAPSHOTS) {
      return // No pruning needed
    }
    
    // Sort by created_at descending, keep the first MAX_SNAPSHOTS
    const sorted = snapshots.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    const toDelete = sorted.slice(MAX_SNAPSHOTS)
    
    console.log('[TimeMachine] Pruning', toDelete.length, 'old snapshots')
    
    for (const snapshot of toDelete) {
      await db.snapshots.delete(snapshot.id)
    }
  } catch (err) {
    console.warn('[TimeMachine] Pruning failed:', err.message)
  }
}

/**
 * Increment the commit counter and auto-snapshot if we've hit the interval.
 * Called by github-writer.js after every successful write.
 */
export async function maybeAutoSnapshot() {
  commitsSinceLastSnapshot++
  
  if (commitsSinceLastSnapshot >= AUTO_SNAPSHOT_INTERVAL) {
    console.log('[TimeMachine] Auto-snapshot triggered after', commitsSinceLastSnapshot, 'commits')
    commitsSinceLastSnapshot = 0
    
    try {
      await createSnapshot()
    } catch (err) {
      console.error('[TimeMachine] Auto-snapshot failed:', err.message)
      // Don't throw — auto-snapshot failures shouldn't block writes
    }
  }
}

/**
 * Get the diff between the current state and a snapshot.
 * Returns files that were added, modified, or deleted since the snapshot.
 */
export async function diffSnapshot(snapshotId) {
  try {
    const reader = buildGithubReader()
    if (!reader) {
      throw new Error('GitHub reader not configured (missing GITHUB_TOKEN or GITHUB_REPO)')
    }
    
    const snapshot = await db.snapshots.findById(snapshotId)
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`)
    }
    
    const snapshotFiles = new Map(
      (snapshot.files_snapshot || []).map(f => [f.path, f.content])
    )
    
    const currentFiles = await reader.listFiles('*')
    const currentPaths = new Set(currentFiles)
    
    const added = []
    const modified = []
    const deleted = []
    
    // Check for added/modified files
    for (const filePath of currentFiles) {
      const snapshotContent = snapshotFiles.get(filePath)
      
      if (!snapshotContent) {
        added.push(filePath)
      } else {
        try {
          const result = await reader.readFile(filePath)
          if (result.content !== snapshotContent) {
            modified.push(filePath)
          }
        } catch (err) {
          console.warn('[TimeMachine] Could not read', filePath, 'for diff:', err.message)
        }
      }
    }
    
    // Check for deleted files
    for (const [path] of snapshotFiles) {
      if (!currentPaths.has(path)) {
        deleted.push(path)
      }
    }
    
    return {
      snapshot_id: snapshotId,
      snapshot_name: snapshot.name,
      added,
      modified,
      deleted,
      total_changes: added.length + modified.length + deleted.length,
    }
  } catch (err) {
    console.error('[TimeMachine] Diff failed:', err)
    throw new Error(`Failed to diff snapshot: ${err.message}`)
  }
}
