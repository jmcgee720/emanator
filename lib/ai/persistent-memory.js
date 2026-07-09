/**
 * PERSISTENT CROSS-SESSION MEMORY
 * 
 * Agents should NEVER ask the user for the same information twice, even across
 * different chat sessions or after forking. This module provides a persistent
 * memory layer that survives session boundaries.
 * 
 * Storage: Supabase `project_memory` table (for project-scoped facts) and
 * `users.metadata.agent_memory` (for user-scoped facts like API keys, preferences).
 * 
 * Design principles:
 *   1. WRITE-THROUGH: Every fact the agent learns is immediately persisted
 *   2. READ-FIRST: Agent checks persistent memory before asking questions
 *   3. CROSS-SESSION: Memory survives chat forks, new chats, browser refreshes
 *   4. SCOPED: Project facts stay with the project, user facts follow the user
 *   5. TIMESTAMPED: Track when facts were learned and last verified
 */

import { db } from '@/lib/supabase/db.js'

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT-SCOPED MEMORY (survives across all chats for a project)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load all persistent memory for a project.
 * Returns a Map<key, { value, learned_at, verified_at, source }>
 */
export async function loadProjectMemory(projectId) {
  if (!projectId) return new Map()
  
  try {
    const entries = await db.projectMemory.findByProjectId(projectId)
    const memory = new Map()
    
    for (const entry of entries) {
      try {
        const value = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value
        memory.set(entry.key, {
          value,
          learned_at: entry.created_at,
          verified_at: entry.updated_at,
          source: value.source || 'unknown',
        })
      } catch {
        // If JSON parse fails, store as-is
        memory.set(entry.key, {
          value: entry.value,
          learned_at: entry.created_at,
          verified_at: entry.updated_at,
          source: 'unknown',
        })
      }
    }
    
    return memory
  } catch (err) {
    console.error('[persistent-memory] Failed to load project memory:', err)
    return new Map()
  }
}

/**
 * Save a fact to project memory.
 * Overwrites existing value if key already exists.
 */
export async function saveProjectFact(projectId, key, value, source = 'agent') {
  if (!projectId || !key) return false
  
  try {
    const existing = await db.projectMemory.findByProjectId(projectId)
    const match = existing.find(e => e.key === key)
    
    const payload = {
      value: typeof value === 'object' ? { ...value, source } : value,
    }
    
    if (match) {
      await db.projectMemory.updateById(match.id, payload)
    } else {
      await db.projectMemory.create({
        project_id: projectId,
        key,
        ...payload,
      })
    }
    
    return true
  } catch (err) {
    console.error('[persistent-memory] Failed to save project fact:', err)
    return false
  }
}

/**
 * Get a single fact from project memory.
 */
export async function getProjectFact(projectId, key) {
  if (!projectId || !key) return null
  
  const memory = await loadProjectMemory(projectId)
  return memory.get(key)?.value || null
}

/**
 * Delete a fact from project memory (for when facts become stale).
 */
export async function deleteProjectFact(projectId, key) {
  if (!projectId || !key) return false
  
  try {
    const entries = await db.projectMemory.findByProjectId(projectId)
    const match = entries.find(e => e.key === key)
    if (match) {
      await db.projectMemory.deleteById(match.id)
      return true
    }
    return false
  } catch (err) {
    console.error('[persistent-memory] Failed to delete project fact:', err)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// USER-SCOPED MEMORY (follows the user across all projects)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load all persistent memory for a user.
 * Returns a Map<key, { value, learned_at, verified_at }>
 */
export async function loadUserMemory(userId) {
  if (!userId) return new Map()
  
  try {
    const user = await db.users.findById(userId)
    if (!user?.metadata?.agent_memory) return new Map()
    
    const memory = new Map()
    const agentMemory = user.metadata.agent_memory
    
    for (const [key, entry] of Object.entries(agentMemory)) {
      memory.set(key, entry)
    }
    
    return memory
  } catch (err) {
    console.error('[persistent-memory] Failed to load user memory:', err)
    return new Map()
  }
}

/**
 * Save a fact to user memory.
 */
export async function saveUserFact(userId, key, value, source = 'agent') {
  if (!userId || !key) return false
  
  try {
    const user = await db.users.findById(userId)
    if (!user) return false
    
    const agentMemory = user.metadata?.agent_memory || {}
    agentMemory[key] = {
      value,
      learned_at: agentMemory[key]?.learned_at || new Date().toISOString(),
      verified_at: new Date().toISOString(),
      source,
    }
    
    await db.users.update(userId, {
      metadata: {
        ...user.metadata,
        agent_memory: agentMemory,
      },
    })
    
    return true
  } catch (err) {
    console.error('[persistent-memory] Failed to save user fact:', err)
    return false
  }
}

/**
 * Get a single fact from user memory.
 */
export async function getUserFact(userId, key) {
  if (!userId || !key) return null
  
  const memory = await loadUserMemory(userId)
  return memory.get(key)?.value || null
}

/**
 * Delete a fact from user memory.
 */
export async function deleteUserFact(userId, key) {
  if (!userId || !key) return false
  
  try {
    const user = await db.users.findById(userId)
    if (!user?.metadata?.agent_memory) return false
    
    const agentMemory = { ...user.metadata.agent_memory }
    delete agentMemory[key]
    
    await db.users.update(userId, {
      metadata: {
        ...user.metadata,
        agent_memory: agentMemory,
      },
    })
    
    return true
  } catch (err) {
    console.error('[persistent-memory] Failed to delete user fact:', err)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY INJECTION (for system prompts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a memory summary for injection into the system prompt.
 * Combines project-scoped and user-scoped memory.
 */
export async function buildPersistentMemorySummary(projectId, userId) {
  const projectMemory = projectId ? await loadProjectMemory(projectId) : new Map()
  const userMemory = userId ? await loadUserMemory(userId) : new Map()
  
  if (projectMemory.size === 0 && userMemory.size === 0) return ''
  
  const parts = []
  
  // Project facts
  if (projectMemory.size > 0) {
    parts.push('## PERSISTENT PROJECT MEMORY (survives across all chats)')
    parts.push('')
    parts.push('Facts about this project that you have learned in previous conversations:')
    parts.push('')
    
    for (const [key, data] of projectMemory.entries()) {
      const age = timeSince(data.learned_at)
      const val = typeof data.value === 'object' ? JSON.stringify(data.value) : data.value
      parts.push(`  • **${key}**: ${val} _(learned ${age} ago)_`)
    }
    parts.push('')
  }
  
  // User facts
  if (userMemory.size > 0) {
    parts.push('## PERSISTENT USER MEMORY (follows this user across all projects)')
    parts.push('')
    parts.push('Facts about this user that you have learned:')
    parts.push('')
    
    for (const [key, data] of userMemory.entries()) {
      const age = timeSince(data.learned_at)
      const val = typeof data.value === 'object' ? JSON.stringify(data.value) : data.value
      parts.push(`  • **${key}**: ${val} _(learned ${age} ago)_`)
    }
    parts.push('')
  }
  
  if (parts.length === 0) return ''
  
  return [
    '',
    '═══════════════════════════════════════════════════════════════════',
    '                    PERSISTENT CROSS-SESSION MEMORY',
    '═══════════════════════════════════════════════════════════════════',
    '',
    ...parts,
    '**CRITICAL RULES**:',
    '  1. NEVER ask the user for information that is already in this memory',
    '  2. If a fact is stale (user says "that changed"), update it immediately',
    '  3. When you learn a new fact, save it to persistent memory so future chats know it',
    '  4. Project facts = deployment URLs, API endpoints, framework choices, file structure',
    '  5. User facts = API keys, preferences, team info, external service credentials',
    '',
  ].join('\n')
}

/**
 * Auto-detect facts from agent actions and save them to persistent memory.
 * Called after each agent turn to capture learnings.
 */
export async function autoSaveFacts(projectId, userId, events) {
  if (!projectId && !userId) return
  
  const facts = extractFactsFromEvents(events)
  
  for (const fact of facts) {
    if (fact.scope === 'project' && projectId) {
      await saveProjectFact(projectId, fact.key, fact.value, fact.source)
    } else if (fact.scope === 'user' && userId) {
      await saveUserFact(userId, fact.key, fact.value, fact.source)
    }
  }
}

/**
 * Extract facts from agent tool calls and responses.
 * Returns an array of { scope, key, value, source } objects.
 */
function extractFactsFromEvents(events) {
  const facts = []
  
  for (const event of events) {
    if (event.type !== 'tool_use' || !event.result) continue
    
    // Detect framework from package.json reads
    if (event.name === 'read_file' && event.input?.path === 'package.json') {
      try {
        const pkg = JSON.parse(event.result.content)
        
        // Detect framework
        if (pkg.dependencies?.react || pkg.devDependencies?.react) {
          facts.push({
            scope: 'project',
            key: 'framework',
            value: 'React',
            source: 'package.json',
          })
        }
        if (pkg.dependencies?.next || pkg.devDependencies?.next) {
          facts.push({
            scope: 'project',
            key: 'framework',
            value: 'Next.js',
            source: 'package.json',
          })
        }
        if (pkg.dependencies?.vue || pkg.devDependencies?.vue) {
          facts.push({
            scope: 'project',
            key: 'framework',
            value: 'Vue',
            source: 'package.json',
          })
        }
        
        // Detect build tool
        if (pkg.devDependencies?.vite) {
          facts.push({
            scope: 'project',
            key: 'build_tool',
            value: 'Vite',
            source: 'package.json',
          })
        }
        if (pkg.dependencies?.['react-scripts']) {
          facts.push({
            scope: 'project',
            key: 'build_tool',
            value: 'Create React App',
            source: 'package.json',
          })
        }
      } catch {
        // Ignore parse errors
      }
    }
    
    // Detect deployment URLs from successful deploys
    if (event.name === 'deploy' && event.result?.deployment_url) {
      facts.push({
        scope: 'project',
        key: 'production_url',
        value: event.result.deployment_url,
        source: 'deployment',
      })
    }
    
    // Learn from deploy_via_github success
    if (event.name === 'deploy_via_github' && typeof event.result === 'string' && event.result.includes('✅')) {
      const urlMatch = event.result.match(/URL: (https:\/\/[^\s]+)/)
      const repoMatch = event.result.match(/github\.com\/([^\s]+)/)
      if (urlMatch) {
        facts.push({
          scope: 'project',
          key: 'production_url',
          value: urlMatch[1],
          source: 'vercel_deployment',
        })
      }
      if (repoMatch) {
        facts.push({
          scope: 'project',
          key: 'github_repo',
          value: repoMatch[1],
          source: 'github_push',
        })
      }
    }
    
    // Learn from deploy_to_vercel success
    if (event.name === 'deploy_to_vercel' && typeof event.result === 'string' && event.result.includes('✅')) {
      const urlMatch = event.result.match(/Deployment URL: (https:\/\/[^\s]+)/)
      if (urlMatch) {
        facts.push({
          scope: 'project',
          key: 'production_url',
          value: urlMatch[1],
          source: 'vercel_deployment',
        })
      }
    }
    
    // Detect API endpoints from code reads
    if (event.name === 'read_file' && event.result?.content) {
      const apiMatches = event.result.content.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s'"`)]*/)
      if (apiMatches) {
        for (const url of apiMatches) {
          if (url.includes('api') || url.includes('backend')) {
            facts.push({
              scope: 'project',
              key: 'api_endpoint',
              value: url,
              source: event.input.path,
            })
          }
        }
      }
    }
  }
  
  return facts
}

/**
 * Helper: format time since a timestamp.
 */
function timeSince(isoString) {
  if (!isoString) return 'unknown'
  
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`
  return 'just now'
}
