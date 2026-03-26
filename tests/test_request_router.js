/**
 * Test suite for request_router.js module
 * Tests the active objective detection and routing upgrade logic
 */

const assert = require('assert')
const path = require('path')

// Mock the database module before importing request_router
const mockDb = {
  changelog: {
    findByProject: null  // Will be overridden in tests
  },
  projectMemory: {
    findByProjectId: null  // Will be overridden in tests
  }
}

// Mock the prompt_library module
const mockPromptLibrary = {
  matchPromptPattern: null  // Will be overridden in tests
}

// Helper to set up mocks
function setupMocks() {
  // Clear require cache to allow fresh imports
  delete require.cache[require.resolve('../lib/self_builder/request_router.js')]
  delete require.cache[require.resolve('../lib/supabase/db.js')]
  delete require.cache[require.resolve('../lib/self_builder/prompt_library.js')]
  
  // Mock modules
  require.cache[require.resolve('../lib/supabase/db.js')] = {
    exports: { db: mockDb }
  }
  require.cache[require.resolve('../lib/self_builder/prompt_library.js')] = {
    exports: mockPromptLibrary
  }
}

async function runTests() {
  console.log('🧪 Starting request_router.js tests...\n')
  
  let passed = 0
  let failed = 0
  
  async function test(name, testFn) {
    try {
      console.log(`🔍 Testing: ${name}`)
      setupMocks()
      await testFn()
      console.log(`✅ PASSED: ${name}\n`)
      passed++
    } catch (error) {
      console.log(`❌ FAILED: ${name}`)
      console.log(`   Error: ${error.message}`)
      console.log(`   Stack: ${error.stack}\n`)
      failed++
    }
  }

  // Test 1: No match, no active objective
  await test('No match, no active objective → returns { type: "no_match" }', async () => {
    mockDb.changelog.findByProject = async () => []
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => null
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'some random input',
      projectId: 'test-project-123',
      memoryEntries: []
    })
    
    assert.deepStrictEqual(result, { type: 'no_match' })
  })

  // Test 2: No match, active objective from changelog
  await test('No match, active objective from changelog → returns match with _continued_from', async () => {
    mockDb.changelog.findByProject = async () => [
      {
        user_task: 'Build a dashboard component',
        task_mode: 'plan',
        plan_summary: 'Create responsive dashboard',
        rejection_reasons: []
      }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => null
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'some random input',
      projectId: 'test-project-123',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'match')
    assert.strictEqual(result._continued_from.source, 'changelog')
    assert.strictEqual(result._continued_from.task, 'Build a dashboard component')
    assert.strictEqual(result._continued_from.task_mode, 'plan')
    assert.strictEqual(result._continued_from.plan_summary, 'Create responsive dashboard')
  })

  // Test 3: No match, active objective from memory
  await test('No match, active objective from memory → returns match with _continued_from', async () => {
    mockDb.changelog.findByProject = async () => []
    mockDb.projectMemory.findByProjectId = async () => [
      {
        key: 'active_objective',
        value: 'Implement authentication system'
      }
    ]
    mockPromptLibrary.matchPromptPattern = () => null
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'some random input',
      projectId: 'test-project-123',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'match')
    assert.strictEqual(result._continued_from.source, 'memory')
    assert.strictEqual(result._continued_from.task, 'Implement authentication system')
    assert.strictEqual(result._continued_from.task_mode, 'plan')
  })

  // Test 4: Ambiguous match, no active objective
  await test('Ambiguous match, no active objective → returns ambiguous_match as-is', async () => {
    mockDb.changelog.findByProject = async () => []
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => ({
      type: 'ambiguous_match',
      candidates: [
        { key: 'pattern1', value: 'Create component' },
        { key: 'pattern2', value: 'Build feature' }
      ]
    })
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'create something',
      projectId: 'test-project-123',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'ambiguous_match')
    assert.strictEqual(result.candidates.length, 2)
  })

  // Test 5: Ambiguous match with candidates, active objective - upgrade to prompt_pattern_match
  await test('Ambiguous match with active objective → upgrades to prompt_pattern_match', async () => {
    mockDb.changelog.findByProject = async () => [
      {
        user_task: 'Active task in progress',
        task_mode: 'execute',
        rejection_reasons: []
      }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => ({
      type: 'ambiguous_match',
      candidates: [
        { key: 'pattern1', value: 'Best matching pattern', _score: 0.8 },
        { key: 'pattern2', value: 'Second best pattern', _score: 0.6 }
      ]
    })
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'create something',
      projectId: 'test-project-123',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'prompt_pattern_match')
    assert.strictEqual(result.pattern.key, 'pattern1')
    assert.strictEqual(result.pattern.value, 'Best matching pattern')
    assert.strictEqual(result._continued_from.source, 'changelog')
    assert.strictEqual(result._continued_from.task, 'Active task in progress')
  })

  // Test 6: Ambiguous match with no candidates, active objective - upgrade to match
  await test('Ambiguous match with no candidates, active objective → upgrades to match', async () => {
    mockDb.changelog.findByProject = async () => [
      {
        user_task: 'Active task in progress',
        task_mode: 'execute',
        rejection_reasons: []
      }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => ({
      type: 'ambiguous_match',
      candidates: []
    })
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'create something',
      projectId: 'test-project-123',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'match')
    assert.strictEqual(result._continued_from.source, 'changelog')
    assert.strictEqual(result._continued_from.task, 'Active task in progress')
  })

  // Test 7: Clean match - returns prompt_pattern_match regardless of objective
  await test('Clean match → returns prompt_pattern_match regardless of objective', async () => {
    mockDb.changelog.findByProject = async () => [
      {
        user_task: 'Active task in progress',
        task_mode: 'execute',
        rejection_reasons: []
      }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => ({
      key: 'exact_pattern',
      value: 'Exact matching pattern',
      _score: 0.95
    })
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'exact pattern match',
      projectId: 'test-project-123',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'prompt_pattern_match')
    assert.strictEqual(result.pattern.key, 'exact_pattern')
    assert.strictEqual(result.pattern.value, 'Exact matching pattern')
    // Should not have _continued_from for clean matches
    assert.strictEqual(result._continued_from, undefined)
  })

  // Test 8: detectActiveObjective returns null when no project
  await test('detectActiveObjective returns null when no project provided', async () => {
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective(null)
    assert.strictEqual(result, null)
    
    const result2 = await detectActiveObjective(undefined)
    assert.strictEqual(result2, null)
    
    const result3 = await detectActiveObjective('')
    assert.strictEqual(result3, null)
  })

  // Test 9: detectActiveObjective skips rejected changelog entries
  await test('detectActiveObjective skips rejected changelog entries', async () => {
    mockDb.changelog.findByProject = async () => [
      {
        user_task: 'Rejected task',
        task_mode: 'plan',
        rejection_reasons: ['Too vague', 'Missing requirements']
      },
      {
        user_task: 'Valid task',
        task_mode: 'execute',
        rejection_reasons: []
      }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result.source, 'changelog')
    assert.strictEqual(result.task, 'Valid task')
    assert.strictEqual(result.task_mode, 'execute')
  })

  // Test 10: detectActiveObjective handles database errors gracefully
  await test('detectActiveObjective handles database errors gracefully', async () => {
    mockDb.changelog.findByProject = async () => {
      throw new Error('Database connection failed')
    }
    mockDb.projectMemory.findByProjectId = async () => {
      throw new Error('Memory table not found')
    }
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result, null)
  })

  // Test 11: detectActiveObjective handles empty changelog gracefully
  await test('detectActiveObjective returns null for empty changelog and memory', async () => {
    mockDb.changelog.findByProject = async () => []
    mockDb.projectMemory.findByProjectId = async () => []
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result, null)
  })

  // Test 12: detectActiveObjective handles tasks that are too short
  await test('detectActiveObjective ignores tasks that are too short', async () => {
    mockDb.changelog.findByProject = async () => [
      {
        user_task: 'Hi',  // Too short (< 5 chars)
        task_mode: 'plan',
        rejection_reasons: []
      }
    ]
    mockDb.projectMemory.findByProjectId = async () => [
      {
        key: 'active_objective',
        value: 'Ok'  // Too short (< 5 chars)
      }
    ]
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result, null)
  })

  // Test 13: Memory active_objective with JSON value
  await test('detectActiveObjective handles JSON active_objective in memory', async () => {
    mockDb.changelog.findByProject = async () => []
    mockDb.projectMemory.findByProjectId = async () => [
      {
        key: 'active_objective',
        value: { task: 'Build user interface', priority: 'high' }
      }
    ]
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result.source, 'memory')
    assert.strictEqual(result.task, '{"task":"Build user interface","priority":"high"}')
    assert.strictEqual(result.task_mode, 'plan')
  })

  // Test 14: Changelog priority over memory (changelog comes first)
  await test('detectActiveObjective prioritizes changelog over memory', async () => {
    mockDb.changelog.findByProject = async () => [
      {
        user_task: 'Changelog active task',
        task_mode: 'execute',
        plan_summary: 'From changelog',
        rejection_reasons: []
      }
    ]
    mockDb.projectMemory.findByProjectId = async () => [
      {
        key: 'active_objective',
        value: 'Memory active task'
      }
    ]
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result.source, 'changelog')
    assert.strictEqual(result.task, 'Changelog active task')
    assert.strictEqual(result.task_mode, 'execute')
    assert.strictEqual(result.plan_summary, 'From changelog')
  })

  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`)
  
  if (failed > 0) {
    console.log('❌ Some tests failed!')
    process.exit(1)
  } else {
    console.log('✅ All tests passed!')
  }
}

// Run the tests
runTests().catch(console.error)