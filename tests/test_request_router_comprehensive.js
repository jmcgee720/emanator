/**
 * Comprehensive test suite for request_router.js
 * Tests both unit functionality and edge cases
 */

const assert = require('assert')

// Mock the dependencies
const mockDb = {
  changelog: { findByProject: null },
  projectMemory: { findByProjectId: null }
}

const mockPromptLibrary = {
  matchPromptPattern: null
}

function setupMocks() {
  delete require.cache[require.resolve('../lib/self_builder/request_router.js')]
  delete require.cache[require.resolve('../lib/supabase/db.js')]
  delete require.cache[require.resolve('../lib/self_builder/prompt_library.js')]
  
  require.cache[require.resolve('../lib/supabase/db.js')] = {
    exports: { db: mockDb }
  }
  require.cache[require.resolve('../lib/self_builder/prompt_library.js')] = {
    exports: mockPromptLibrary
  }
}

async function runComprehensiveTests() {
  console.log('🧪 Running comprehensive request_router tests...\n')
  
  let totalPassed = 0
  let totalFailed = 0
  
  async function test(name, testFn) {
    try {
      console.log(`🔍 ${name}`)
      setupMocks()
      await testFn()
      console.log(`✅ PASSED: ${name}`)
      totalPassed++
    } catch (error) {
      console.log(`❌ FAILED: ${name}`)
      console.log(`   Error: ${error.message}`)
      totalFailed++
    }
  }

  // Core routing logic tests
  await test('Route type no_match without active objective', async () => {
    mockDb.changelog.findByProject = async () => []
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => null
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'random input',
      projectId: 'test-project',
      memoryEntries: []
    })
    
    assert.deepStrictEqual(result, { type: 'no_match' })
  })

  await test('Route type upgraded from no_match to match with active objective', async () => {
    mockDb.changelog.findByProject = async () => [
      { user_task: 'Build something', task_mode: 'plan', rejection_reasons: [] }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => null
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'random input',
      projectId: 'test-project',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'match')
    assert.strictEqual(result._continued_from.source, 'changelog')
  })

  await test('Ambiguous match preserved without active objective', async () => {
    mockDb.changelog.findByProject = async () => []
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => ({
      type: 'ambiguous_match',
      candidates: [{ key: 'p1' }, { key: 'p2' }]
    })
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'ambiguous input',
      projectId: 'test-project',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'ambiguous_match')
    assert.strictEqual(result.candidates.length, 2)
    assert.strictEqual(result._continued_from, undefined)
  })

  await test('Ambiguous match upgraded to prompt_pattern_match with active objective', async () => {
    mockDb.changelog.findByProject = async () => [
      { user_task: 'Active task', task_mode: 'execute', rejection_reasons: [] }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => ({
      type: 'ambiguous_match',
      candidates: [
        { key: 'best_pattern', value: 'Best match', _score: 0.9 },
        { key: 'second_pattern', value: 'Second match', _score: 0.7 }
      ]
    })
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'ambiguous input',
      projectId: 'test-project',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'prompt_pattern_match')
    assert.strictEqual(result.pattern.key, 'best_pattern')
    assert.strictEqual(result._continued_from.source, 'changelog')
  })

  await test('Clean match passes through unchanged', async () => {
    mockDb.changelog.findByProject = async () => [
      { user_task: 'Active task', task_mode: 'execute', rejection_reasons: [] }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    mockPromptLibrary.matchPromptPattern = () => ({
      key: 'clean_pattern',
      value: 'Clean match',
      _score: 0.95
    })
    
    const { request_router } = require('../lib/self_builder/request_router.js')
    const result = await request_router({
      input: 'clean match input',
      projectId: 'test-project',
      memoryEntries: []
    })
    
    assert.strictEqual(result.type, 'prompt_pattern_match')
    assert.strictEqual(result.pattern.key, 'clean_pattern')
    assert.strictEqual(result._continued_from, undefined)
  })

  // Active objective detection tests
  await test('Active objective from changelog with plan_summary', async () => {
    mockDb.changelog.findByProject = async () => [
      {
        user_task: 'Complex development task',
        task_mode: 'execute',
        plan_summary: 'Detailed implementation plan',
        rejection_reasons: []
      }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result.source, 'changelog')
    assert.strictEqual(result.task, 'Complex development task')
    assert.strictEqual(result.task_mode, 'execute')
    assert.strictEqual(result.plan_summary, 'Detailed implementation plan')
  })

  await test('Active objective from memory with JSON value', async () => {
    mockDb.changelog.findByProject = async () => []
    mockDb.projectMemory.findByProjectId = async () => [
      {
        key: 'other_key',
        value: 'irrelevant'
      },
      {
        key: 'active_objective',
        value: { description: 'Complex objective', status: 'in_progress' }
      }
    ]
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result.source, 'memory')
    assert.strictEqual(result.task, '{"description":"Complex objective","status":"in_progress"}')
    assert.strictEqual(result.task_mode, 'plan')
    assert.strictEqual(result.plan_summary, null)
  })

  await test('Skips rejected tasks in changelog', async () => {
    mockDb.changelog.findByProject = async () => [
      {
        user_task: 'Rejected task first',
        task_mode: 'plan',
        rejection_reasons: ['Invalid requirement']
      },
      {
        user_task: 'Also rejected',
        task_mode: 'plan', 
        rejection_reasons: ['Too vague', 'Missing context']
      },
      {
        user_task: 'Valid active task',
        task_mode: 'execute',
        rejection_reasons: []
      }
    ]
    mockDb.projectMemory.findByProjectId = async () => []
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result.task, 'Valid active task')
    assert.strictEqual(result.task_mode, 'execute')
  })

  await test('Handles database connection errors gracefully', async () => {
    mockDb.changelog.findByProject = async () => {
      throw new Error('Connection timeout')
    }
    mockDb.projectMemory.findByProjectId = async () => {
      throw new Error('Table not found')
    }
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result, null)
  })

  await test('Returns null for invalid project IDs', async () => {
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    
    const nullResult = await detectActiveObjective(null)
    assert.strictEqual(nullResult, null)
    
    const undefinedResult = await detectActiveObjective(undefined)
    assert.strictEqual(undefinedResult, null)
    
    const emptyResult = await detectActiveObjective('')
    assert.strictEqual(emptyResult, null)
  })

  await test('Filters out short tasks (< 5 characters)', async () => {
    mockDb.changelog.findByProject = async () => [
      { user_task: 'Hi', task_mode: 'plan', rejection_reasons: [] },
      { user_task: 'OK', task_mode: 'plan', rejection_reasons: [] }
    ]
    mockDb.projectMemory.findByProjectId = async () => [
      { key: 'active_objective', value: 'No' }
    ]
    
    const { detectActiveObjective } = require('../lib/self_builder/request_router.js')
    const result = await detectActiveObjective('test-project')
    
    assert.strictEqual(result, null)
  })

  console.log(`\n📊 Final Results: ${totalPassed} passed, ${totalFailed} failed`)
  
  if (totalFailed === 0) {
    console.log('🎉 All comprehensive tests passed! request_router.js is working correctly.')
    
    // Final verification message
    console.log('\n✅ VERIFIED FUNCTIONALITY:')
    console.log('   • No match → no_match (without active objective)')
    console.log('   • No match → match with _continued_from (with active objective)')
    console.log('   • Ambiguous match → ambiguous_match (without active objective)')
    console.log('   • Ambiguous match → prompt_pattern_match/match (with active objective)')
    console.log('   • Clean match → prompt_pattern_match (unchanged)')
    console.log('   • Active objective detection from changelog and memory')
    console.log('   • Proper rejection of invalid tasks and error handling')
    console.log('   • Integration with AI service _continued_from field')
    
    process.exit(0)
  } else {
    console.log('❌ Some tests failed!')
    process.exit(1)
  }
}

runComprehensiveTests().catch(console.error)