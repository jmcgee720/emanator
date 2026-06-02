#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────
// IMMEDIATE CLEANUP: Remove node_modules rows for Mangia Mama
// ──────────────────────────────────────────────────────────────────────
// This script directly cleans up the corrupted node_modules rows for
// project e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed (Mangia Mama) that are
// causing the "Cannot find module vite/dist/node/chunks/dep-D-7KCb9p.js"
// error.
//
// Usage:
//   node scripts/cleanup-mangia-mama-now.js
//
// Requires env vars:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ──────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

const PROJECT_ID = 'e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed'

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
  console.log(`[cleanup] Removing node_modules rows for Mangia Mama (${PROJECT_ID})…`)
  
  // First, count how many rows we're about to delete
  const { count, error: countError } = await supabase
    .from('project_files')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', PROJECT_ID)
    .or('path.like.%/node_modules/%,path.like.node_modules/%')
  
  if (countError) {
    console.error('[cleanup] Failed to count rows:', countError)
    process.exit(1)
  }
  
  console.log(`[cleanup] Found ${count} node_modules rows to delete`)
  
  if (count === 0) {
    console.log('[cleanup] Nothing to delete — project is already clean')
    console.log('[cleanup] The error may be caused by a different issue.')
    console.log('[cleanup] Check the runner logs for the actual failure.')
    return
  }
  
  // Delete all rows where path contains node_modules
  const { error: deleteError } = await supabase
    .from('project_files')
    .delete()
    .eq('project_id', PROJECT_ID)
    .or('path.like.%/node_modules/%,path.like.node_modules/%')
  
  if (deleteError) {
    console.error('[cleanup] Failed to delete rows:', deleteError)
    process.exit(1)
  }
  
  console.log(`[cleanup] ✅ Successfully deleted ${count} node_modules rows`)
  console.log('[cleanup] Next steps:')
  console.log('[cleanup]   1. Stop the preview machine (if running)')
  console.log('[cleanup]   2. Start the preview again')
  console.log('[cleanup]   3. The runner will do a fresh npm install')
  console.log('[cleanup]   4. Vite should start successfully')
  console.log('[cleanup] DONE')
}

cleanup().catch(err => {
  console.error('[cleanup] Unexpected error:', err)
  process.exit(1)
})
