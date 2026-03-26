/**
 * DEBUG VERSION - Investigate failing tests 6 and 11
 */

const assert = require('assert')

// Mock database layer (same as before)
const mockDb = {
  projectMemory: {
    data: new Map(),
    _nextId: 1,
    
    async findByProjectId(projectId) {
      return Array.from(this.data.values()).filter(entry => entry.project_id === projectId)
    },
    
    async create(entry) {
      const id = this._nextId++
      const created = { id, ...entry, created_at: new Date().toISOString() }
      this.data.set(id, created)
      return created
    },
    
    clear() {
      this.data.clear()
      this._nextId = 1
    }
  },
  
  changelog: { data: [], async create(entry) { this.data.push(entry); return entry }, clear() { this.data = [] } }
}

// Mock modules
const Module = require('module')
const originalRequire = Module.prototype.require

Module.prototype.require = function(id) {
  if (id === '../supabase/db' || id === '../supabase/db.js') {
    return { db: mockDb }
  }
  return originalRequire.apply(this, arguments)
}

const { matchPromptPattern } = require('../../lib/self_builder/prompt_library.js')

async function debug_test_6_threshold_crossing() {
  mockDb.projectMemory.clear()
  
  const projectId = 'proj_threshold'
  
  await mockDb.projectMemory.create({
    project_id: projectId,
    key: 'prompt_pattern:threshold_test',
    value: JSON.stringify({
      text: 'implement user authentication system',
      usage_count: 0,
      success_count: 1,
      projectId: projectId
    })
  })
  
  const entries = await mockDb.projectMemory.findByProjectId(projectId)
  const input = 'add authentication features'
  
  console.log('\n=== DEBUG TEST 6: Threshold Crossing ===')
  console.log('Pattern text:', 'implement user authentication system')
  console.log('Input text:', input)
  
  const match = matchPromptPattern(entries, input, projectId)
  
  if (match) {
    console.log('✅ Match found!')
    console.log('Final score:', match._score)
    console.log('Metadata:', match._meta)
    
    // Let's also test without projectId to see the difference
    const matchWithoutProjectId = matchPromptPattern(entries, input)
    if (matchWithoutProjectId) {
      console.log('Score WITHOUT projectId:', matchWithoutProjectId._score)
      console.log('Score difference (scope boost):', match._score - matchWithoutProjectId._score)
    } else {
      console.log('WITHOUT projectId: NO MATCH - this confirms scope boost is helping')
    }
  } else {
    console.log('❌ No match found')
    
    // Check without projectId
    const matchWithoutProjectId = matchPromptPattern(entries, input)
    if (matchWithoutProjectId) {
      console.log('BUT with no projectId, score would be:', matchWithoutProjectId._score)
    } else {
      console.log('Even without projectId: NO MATCH - base similarity too low')
    }
  }
}

async function debug_test_11_boost_vs_penalty() {
  mockDb.projectMemory.clear()
  
  const projectId = 'proj_mixed_test'
  const globalProjectId = 'proj_global_mixed'
  
  // Same-project positive pattern
  await mockDb.projectMemory.create({
    project_id: projectId,
    key: 'prompt_pattern:same_project_positive',
    value: JSON.stringify({
      text: 'build api endpoints',
      usage_count: 1,
      success_count: 1,
      projectId: projectId
    })
  })
  
  // Global rejected pattern
  await mockDb.projectMemory.create({
    project_id: projectId,
    key: 'rejected_prompt_pattern:global_rejected',
    value: JSON.stringify({
      text: 'build api system',
      reject_count: 1,
      usage_count: 1,
      projectId: globalProjectId
    })
  })
  
  const entries = await mockDb.projectMemory.findByProjectId(projectId)
  const input = 'build api system with authentication'
  
  console.log('\n=== DEBUG TEST 11: Boost vs Penalty ===')
  console.log('Positive pattern:', 'build api endpoints')
  console.log('Rejected pattern:', 'build api system') 
  console.log('Input text:', input)
  
  const match = matchPromptPattern(entries, input, projectId)
  
  if (match) {
    console.log('✅ Match found!')
    console.log('Final score:', match._score)
    console.log('Matched pattern projectId:', match._meta.projectId)
    console.log('Expected projectId:', projectId)
    console.log('Match:', match._meta.projectId === projectId ? 'SAME-PROJECT ✅' : 'GLOBAL ❌')
  } else {
    console.log('❌ No match found')
    
    // Test individual components
    console.log('\nTesting without rejected patterns...')
    const entriesPositiveOnly = entries.filter(e => !e.key.startsWith('rejected_prompt_pattern:'))
    const matchPositiveOnly = matchPromptPattern(entriesPositiveOnly, input, projectId)
    if (matchPositiveOnly) {
      console.log('Positive-only score:', matchPositiveOnly._score)
    } else {
      console.log('Even positive-only: NO MATCH')
    }
  }
}

async function run_debug() {
  console.log('🔍 DEBUGGING FAILING TESTS')
  console.log('==========================')
  
  try {
    await debug_test_6_threshold_crossing()
  } catch (error) {
    console.log('Debug test 6 error:', error.message)
  }
  
  try {
    await debug_test_11_boost_vs_penalty()
  } catch (error) {
    console.log('Debug test 11 error:', error.message)
  }
}

run_debug().catch(console.error)