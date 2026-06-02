#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────
// Check if a project has node_modules rows in the database
// ──────────────────────────────────────────────────────────────────────
// This script checks how many node_modules rows exist in the database
// for a given project. Use this to verify if cleanup is needed.
//
// Usage:
//   node scripts/check-node-modules-in-db.js <project-id>
//
// Example:
//   node scripts/check-node-modules-in-db.js e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed
// ──────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

const projectId = process.argv[2]
if (!projectId) {
  console.error('Usage: node scripts/check-node-modules-in-db.js <project-id>')
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

async function check() {
  console.log(`[check] Counting node_modules rows for project ${projectId}…`)
  
  const { count, error } = await supabase
    .from('project_files')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .or('path.like.%/node_modules/%,path.like.node_modules/%')
  
  if (error) {
    console.error('[check] Failed to count rows:', error)
    process.exit(1)
  }
  
  console.log(`[check] Found ${count} node_modules rows`)
  
  if (count === 0) {
    console.log('[check] ✅ Database is clean — no cleanup needed')
  } else {
    console.log(`[check] ⚠️  Database contains ${count} corrupted node_modules rows`)
    console.log('[check] Run cleanup to fix:')
    console.log(`[check]   node scripts/cleanup-node-modules-from-db.js ${projectId}`)
    console.log('[check] OR')
    console.log(`[check]   POST /api/previews/${projectId}/cleanup-node-modules`)
  }
  
  // Also show a sample of the paths
  if (count > 0) {
    const { data: sample } = await supabase
      .from('project_files')
      .select('path')
      .eq('project_id', projectId)
      .or('path.like.%/node_modules/%,path.like.node_modules/%')
      .limit(10)
    
    console.log('[check] Sample paths:')
    sample?.forEach(row => console.log(`[check]   - ${row.path}`))
    if (count > 10) {
      console.log(`[check]   ... and ${count - 10} more`)
    }
  }
}

check().catch(err => {
  console.error('[check] Unexpected error:', err)
  process.exit(1)
})
