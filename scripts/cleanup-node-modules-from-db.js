#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────
// Database cleanup: remove node_modules rows from project_files table
// ──────────────────────────────────────────────────────────────────────
// PROBLEM: The sync process was treating node_modules/ as source files
// and writing them to the database. This caused "removed 13552 stale"
// bugs that deleted critical dependency files on subsequent syncs.
//
// This script removes all node_modules rows for a given project so the
// next runner sync starts clean.
//
// Usage:
//   node scripts/cleanup-node-modules-from-db.js <project-id>
//
// Example:
//   node scripts/cleanup-node-modules-from-db.js e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed
// ──────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

const projectId = process.argv[2]
if (!projectId) {
  console.error('Usage: node scripts/cleanup-node-modules-from-db.js <project-id>')
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function cleanup() {
  console.log(`[cleanup] Removing node_modules rows for project ${projectId}…`)
  
  // First, count how many rows we're about to delete
  const { count, error: countError } = await supabase
    .from('project_files')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .or('path.like.%/node_modules/%,path.like.node_modules/%')
  
  if (countError) {
    console.error('[cleanup] Failed to count rows:', countError)
    process.exit(1)
  }
  
  console.log(`[cleanup] Found ${count} node_modules rows to delete`)
  
  if (count === 0) {
    console.log('[cleanup] Nothing to delete — project is already clean')
    return
  }
  
  // Delete all rows where path contains node_modules
  const { error: deleteError } = await supabase
    .from('project_files')
    .delete()
    .eq('project_id', projectId)
    .or('path.like.%/node_modules/%,path.like.node_modules/%')
  
  if (deleteError) {
    console.error('[cleanup] Failed to delete rows:', deleteError)
    process.exit(1)
  }
  
  console.log(`[cleanup] Successfully deleted ${count} node_modules rows`)
  console.log('[cleanup] Next runner sync will do a fresh npm install')
  console.log('[cleanup] DONE')
}

cleanup().catch(err => {
  console.error('[cleanup] Unexpected error:', err)
  process.exit(1)
})
