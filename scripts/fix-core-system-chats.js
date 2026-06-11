#!/usr/bin/env node
/**
 * Fix Core System chats visibility
 * 
 * Problem: Older Core System chats don't have the ⚙ Self-Edit: prefix in their
 * title, so they're filtered out of the chat list when in Core System mode.
 * 
 * Solution: Find all chats belonging to Core System projects (settings.is_core = true)
 * and ensure their titles start with the SELF_EDIT_PREFIX.
 * 
 * Usage: node scripts/fix-core-system-chats.js
 */

import { db } from '../lib/supabase/db.js'

const SELF_EDIT_PREFIX = '\u2699 Self-Edit: '

async function fixCoreSystemChats() {
  console.log('[fix-core-system-chats] Starting...')
  
  try {
    // Find all Core System projects
    const { data: allProjects, error: projectsError } = await db.getSupabaseAdmin()
      .from('projects')
      .select('id, name, settings')
    
    if (projectsError) {
      console.error('[fix-core-system-chats] Error fetching projects:', projectsError)
      return
    }
    
    const coreProjects = allProjects.filter(p => p.settings?.is_core === true)
    console.log(`[fix-core-system-chats] Found ${coreProjects.length} Core System project(s)`)
    
    if (coreProjects.length === 0) {
      console.log('[fix-core-system-chats] No Core System projects found. Nothing to fix.')
      return
    }
    
    let totalFixed = 0
    
    for (const project of coreProjects) {
      console.log(`[fix-core-system-chats] Processing project: ${project.name} (${project.id})`)
      
      // Get all chats for this project
      const chats = await db.chats.findByProjectId(project.id)
      console.log(`[fix-core-system-chats]   Found ${chats.length} chat(s)`)
      
      for (const chat of chats) {
        // Check if title already has the prefix
        if (chat.title.startsWith(SELF_EDIT_PREFIX)) {
          console.log(`[fix-core-system-chats]   ✓ Chat "${chat.title}" already has prefix`)
          continue
        }
        
        // Add the prefix
        const newTitle = `${SELF_EDIT_PREFIX}${chat.title}`
        console.log(`[fix-core-system-chats]   → Updating "${chat.title}" to "${newTitle}"`)
        
        try {
          await db.chats.update(chat.id, { title: newTitle })
          totalFixed++
          console.log(`[fix-core-system-chats]   ✓ Updated successfully`)
        } catch (updateError) {
          console.error(`[fix-core-system-chats]   ✗ Failed to update chat ${chat.id}:`, updateError)
        }
      }
    }
    
    console.log(`\n[fix-core-system-chats] Complete! Fixed ${totalFixed} chat(s).`)
    
  } catch (error) {
    console.error('[fix-core-system-chats] Fatal error:', error)
    process.exit(1)
  }
}

fixCoreSystemChats()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[fix-core-system-chats] Unhandled error:', err)
    process.exit(1)
  })
