const assert = require('assert')

// Mock the database layer before requiring the modules under test
const mockEntries = []
let nextId = 1
const mockDb = {
  projectMemory: {
    findByProjectId: (projectId) => Promise.resolve(mockEntries), // Return reference, not copy
    create: (entry) => {
      const newEntry = { id: nextId++, ...entry }
      mockEntries.push(newEntry)
      return Promise.resolve(newEntry)
    },
    updateById: (id, updates) => {
      const entry = mockEntries.find(e => e.id === id)
      if (entry) Object.assign(entry, updates)
      return Promise.resolve(entry)
    }
  },
  changelog: {
    create: () => Promise.resolve({}),
    findByProject: () => Promise.resolve([]),
    findLastRejectedForTask: () => Promise.resolve(null)
  }
}

// Mock the db module
require.cache[require.resolve('../../lib/supabase/db')] = {
  exports: { db: mockDb }
}

// Now require the modules under test
const { logChange } = require('../../lib/self_builder/change_log.js')
const { getUserPreferences, parsePreferenceValue, computePreferenceBoost, matchPromptPattern } = require('../../lib/self_builder/prompt_library.js')
const { request_router } = require('../../lib/self_builder/request_router.js')

// Test execution
async function runTests() {
  console.log('🧪 Running User Preference Memory System Tests...\n')
  
  let totalTests = 0
  let passedTests = 0
  
  const runTest = async (testName, testFn) => {
    totalTests++
    try {
      // Clear mock data before each test
      mockEntries.length = 0
      nextId = 1
      await testFn()
      console.log(`  ✅ ${testName}`)
      passedTests++
    } catch (error) {
      console.log(`  ❌ ${testName}: ${error.message}`)
    }
  }

  const runTestWithoutClear = async (testName, testFn) => {
    totalTests++
    try {
      // DON'T clear mock data for this test
      await testFn()
      console.log(`  ✅ ${testName}`)
      passedTests++
    } catch (error) {
      console.log(`  ❌ ${testName}: ${error.message}`)
    }
  }
  
  try {
    // Test Suite 1: change_log.js - User Preference Storage
    console.log('📋 change_log.js - User Preference Storage')
    
    await runTest('logChange with result=applied and single file signal stores user_preference:file_scope:single', async () => {
      const projectId = 'proj1'
      const userId = 'user1'
      const userTask = 'Update the single file component.jsx with new logic'
      
      await logChange({ projectId, userId, userTask, taskMode: 'patch', result: 'applied' })
      
      const prefEntry = mockEntries.find(e => e.key === 'user_preference:file_scope:single')
      assert(prefEntry, 'Preference entry should be created')
      
      const prefValue = JSON.parse(prefEntry.value)
      assert.strictEqual(prefValue.type, 'file_scope')
      assert.strictEqual(prefValue.value, 'single') 
      assert.strictEqual(prefValue.count, 1)
      assert.strictEqual(prefValue.userId, userId)
    })

    await runTest('logChange with result=applied and create signal stores user_preference:edit_mode:create', async () => {
      const projectId = 'proj1'
      const userId = 'user1'
      const userTask = 'Create new file for authentication module'
      
      await logChange({ projectId, userId, userTask, taskMode: 'patch', result: 'applied' })
      
      const prefEntry = mockEntries.find(e => e.key === 'user_preference:edit_mode:create')
      assert(prefEntry, 'Preference entry should be created')
      
      const prefValue = JSON.parse(prefEntry.value)
      assert.strictEqual(prefValue.type, 'edit_mode')
      assert.strictEqual(prefValue.value, 'create')
      assert.strictEqual(prefValue.count, 1)
      assert.strictEqual(prefValue.userId, userId)
    })

    await runTest('logChange with result=applied and directory path stores user_preference:directory', async () => {
      const projectId = 'proj1' 
      const userId = 'user1'
      const userTask = 'Update lib/self_builder/change_log.js with new preference logic'
      
      await logChange({ projectId, userId, userTask, taskMode: 'plan', result: 'applied' })
      
      // The regex captures 'lib/self_builder/change_log' not the full path with .js
      const prefEntry = mockEntries.find(e => e.key === 'user_preference:directory:lib/self_builder/change_log')
      assert(prefEntry, 'Directory preference entry should be created')
      
      const prefValue = JSON.parse(prefEntry.value)
      assert.strictEqual(prefValue.type, 'directory')
      assert.strictEqual(prefValue.value, 'lib/self_builder/change_log')
      assert.strictEqual(prefValue.count, 1)
      assert.strictEqual(prefValue.userId, userId)
    })

    await runTest('logChange with result=applied and no preference signals stores no preferences', async () => {
      const projectId = 'proj1'
      const userId = 'user1' 
      const userTask = 'Debug the authentication flow issue'
      
      await logChange({ projectId, userId, userTask, taskMode: 'patch', result: 'applied' })
      
      const prefEntries = mockEntries.filter(e => e.key && e.key.startsWith('user_preference:'))
      assert.strictEqual(prefEntries.length, 0, 'No preference entries should be created')
    })

    await runTest('logChange with result=applied but no userId stores no preferences', async () => {
      const projectId = 'proj1'
      const userTask = 'Update single file component.jsx with new logic'
      
      await logChange({ projectId, userTask, taskMode: 'patch', result: 'applied' })
      
      const prefEntries = mockEntries.filter(e => e.key && e.key.startsWith('user_preference:'))
      assert.strictEqual(prefEntries.length, 0, 'No preference entries should be created without userId')
    })

    await runTest('repeated applied task with same signal increments existing preference count', async () => {
      const projectId = 'proj1'
      const userId = 'user1' 
      const userTask1 = 'Update single file component.jsx with new logic'
      const userTask2 = 'Modify one file for the login form'
      
      // First application
      await logChange({ projectId, userId, userTask: userTask1, taskMode: 'patch', result: 'applied' })
      
      // Second application with same signal - should increment existing preference
      await logChange({ projectId, userId, userTask: userTask2, taskMode: 'patch', result: 'applied' })
      
      const prefEntry = mockEntries.find(e => e.key === 'user_preference:file_scope:single')
      assert(prefEntry, 'Preference entry should exist')
      
      const prefValue = JSON.parse(prefEntry.value)
      assert.strictEqual(prefValue.count, 2, 'Count should be incremented')
      assert.strictEqual(prefValue.userId, userId)
    })

    await runTest('logChange with result=discarded stores no preferences', async () => {
      const projectId = 'proj1'
      const userId = 'user1'
      const userTask = 'Update single file component.jsx with new logic' 
      
      await logChange({ projectId, userId, userTask, taskMode: 'patch', result: 'discarded' })
      
      const prefEntries = mockEntries.filter(e => e.key && e.key.startsWith('user_preference:'))
      assert.strictEqual(prefEntries.length, 0, 'No preference entries should be created for discarded results')
    })
    
    console.log()

    // Test Suite 2: prompt_library.js - User Preference Handling
    console.log('📋 prompt_library.js - User Preference Handling')
    
    await runTest('getUserPreferences filters only user_preference entries matching userId', async () => {
      const memoryEntries = [
        { key: 'user_preference:file_scope:single', value: JSON.stringify({ userId: 'user1', count: 2 }) },
        { key: 'user_preference:edit_mode:create', value: JSON.stringify({ userId: 'user2', count: 1 }) },
        { key: 'prompt_pattern:test', value: 'test pattern' },
        { key: 'user_preference:directory:lib', value: JSON.stringify({ userId: 'user1', count: 1 }) }
      ]
      
      const userPrefs = getUserPreferences(memoryEntries, 'user1')
      
      assert.strictEqual(userPrefs.length, 2)
      assert(userPrefs.some(p => p.key === 'user_preference:file_scope:single'))
      assert(userPrefs.some(p => p.key === 'user_preference:directory:lib'))
      assert(!userPrefs.some(p => p.key === 'user_preference:edit_mode:create'))
    })

    await runTest('getUserPreferences with no userId returns empty array', async () => {
      const memoryEntries = [
        { key: 'user_preference:file_scope:single', value: JSON.stringify({ userId: 'user1', count: 2 }) }
      ]
      
      const userPrefs = getUserPreferences(memoryEntries, null)
      assert.strictEqual(userPrefs.length, 0)
    })

    await runTest('parsePreferenceValue parses JSON correctly', async () => {
      const jsonValue = JSON.stringify({ type: 'file_scope', value: 'single', count: 3, userId: 'user1' })
      const parsed = parsePreferenceValue(jsonValue)
      
      assert.strictEqual(parsed.type, 'file_scope')
      assert.strictEqual(parsed.value, 'single')
      assert.strictEqual(parsed.count, 3)
      assert.strictEqual(parsed.userId, 'user1')
    })

    await runTest('computePreferenceBoost with aligned pattern returns positive boost', async () => {
      const preferences = [
        {
          key: 'user_preference:file_scope:single',
          value: JSON.stringify({ type: 'file_scope', value: 'single', count: 3, userId: 'user1' })
        }
      ]
      const patternText = 'Update single file component with new logic'
      
      const boost = computePreferenceBoost(patternText, preferences)
      
      assert(boost > 0, 'Boost should be positive for aligned pattern')
      assert(boost <= 0.15, 'Boost should be capped at 0.15')
    })

    await runTest('computePreferenceBoost with non-aligned pattern returns 0', async () => {
      const preferences = [
        {
          key: 'user_preference:file_scope:single', 
          value: JSON.stringify({ type: 'file_scope', value: 'single', count: 3, userId: 'user1' })
        }
      ]
      const patternText = 'Update multiple files across the entire project'
      
      const boost = computePreferenceBoost(patternText, preferences)
      assert.strictEqual(boost, 0, 'Boost should be 0 for non-aligned pattern')
    })

    await runTest('computePreferenceBoost with multiple aligned preferences sums but caps at 0.15', async () => {
      const preferences = [
        {
          key: 'user_preference:file_scope:single',
          value: JSON.stringify({ type: 'file_scope', value: 'single', count: 5, userId: 'user1' })
        },
        {
          key: 'user_preference:edit_mode:update', 
          value: JSON.stringify({ type: 'edit_mode', value: 'update', count: 10, userId: 'user1' })
        },
        {
          key: 'user_preference:patch_style:minimal',
          value: JSON.stringify({ type: 'patch_style', value: 'minimal', count: 8, userId: 'user1' })
        }
      ]
      const patternText = 'Update single file with minimal changes to fix the issue'
      
      const boost = computePreferenceBoost(patternText, preferences)
      assert.strictEqual(boost, 0.15, 'Boost should be capped at 0.15 even with multiple aligned preferences')
    })

    await runTest('matchPromptPattern with no preferences has same behavior as before', async () => {
      const memoryEntries = [
        {
          key: 'prompt_pattern:test',
          value: JSON.stringify({ text: 'fix authentication bug', usage_count: 2, success_count: 1 })
        }
      ]
      
      const match = matchPromptPattern(memoryEntries, 'fix auth bug', 'proj1', null)
      
      // Should match the pattern without preference boost
      assert(match, 'Should find a match')
      assert.strictEqual(match.key, 'prompt_pattern:test')
    })

    await runTest('matchPromptPattern with userId and aligned preference increases candidate score', async () => {
      const memoryEntries = [
        {
          key: 'prompt_pattern:test',
          value: JSON.stringify({ text: 'fix single file auth bug', usage_count: 1, success_count: 1 })
        },
        {
          key: 'user_preference:file_scope:single',
          value: JSON.stringify({ type: 'file_scope', value: 'single', count: 3, userId: 'user1' })
        }
      ]
      
      const matchWithoutPref = matchPromptPattern(memoryEntries, 'fix single file bug', 'proj1', null)
      const matchWithPref = matchPromptPattern(memoryEntries, 'fix single file bug', 'proj1', 'user1')
      
      assert(matchWithoutPref, 'Should match without preferences')
      assert(matchWithPref, 'Should match with preferences')
      
      // The match with preferences should have higher score due to preference boost
      assert(matchWithPref._score > matchWithoutPref._score, 'Score should be higher with preference boost')
    })

    await runTest('matchPromptPattern with userId but no aligned preferences has no boost applied', async () => {
      const memoryEntries = [
        {
          key: 'prompt_pattern:test', 
          value: JSON.stringify({ text: 'fix authentication bug', usage_count: 1, success_count: 1 })
        },
        {
          key: 'user_preference:file_scope:single',
          value: JSON.stringify({ type: 'file_scope', value: 'single', count: 3, userId: 'user1' })
        }
      ]
      
      const matchWithoutPref = matchPromptPattern(memoryEntries, 'fix auth bug across multiple files', 'proj1', null)
      const matchWithPref = matchPromptPattern(memoryEntries, 'fix auth bug across multiple files', 'proj1', 'user1')
      
      assert(matchWithoutPref, 'Should match without preferences')
      assert(matchWithPref, 'Should match with preferences')
      
      // Scores should be equal since no preference alignment
      assert.strictEqual(matchWithPref._score, matchWithoutPref._score, 'Scores should be equal with no preference alignment')
    })

    console.log()

    // Test Suite 3: request_router.js - userId Integration
    console.log('📋 request_router.js - userId Integration')
    
    await runTest('request_router accepts and passes userId to matchPromptPattern', async () => {
      const memoryEntries = [
        {
          key: 'prompt_pattern:test',
          value: JSON.stringify({ text: 'fix single file auth', usage_count: 1, success_count: 1 })
        },
        {
          key: 'user_preference:file_scope:single',
          value: JSON.stringify({ type: 'file_scope', value: 'single', count: 2, userId: 'user1' })
        }
      ]
      
      const result = await request_router({
        input: 'fix single file auth bug',
        projectId: 'proj1', 
        userId: 'user1',
        memoryEntries
      })
      
      assert(result, 'Should return a result')
      assert.strictEqual(result.type, 'prompt_pattern_match', 'Should match the pattern')
      assert(result.pattern, 'Should include the matched pattern')
      
      // The pattern should benefit from preference boost (indicated by higher score)
      assert(result.pattern._score > 0.5, 'Score should reflect preference boost')
    })
    
    console.log()

    // Test Suite 4: Integration Test
    console.log('📋 Integration Test - End-to-End User Preference Flow')
    
    await runTest('complete preference learning and application flow', async () => {
      const projectId = 'proj1'
      const userId = 'user1'
      
      // Step 1: User completes a successful task with preference signals
      await logChange({ 
        projectId, 
        userId, 
        userTask: 'Update single file component.jsx with minimal changes',
        taskMode: 'patch', 
        result: 'applied' 
      })
      
      // Step 2: Verify preferences were stored
      const fileScope = mockEntries.find(e => e.key === 'user_preference:file_scope:single')
      const patchStyle = mockEntries.find(e => e.key === 'user_preference:patch_style:minimal')
      const editMode = mockEntries.find(e => e.key === 'user_preference:edit_mode:update')
      
      assert(fileScope, 'File scope preference should be stored')
      assert(patchStyle, 'Patch style preference should be stored') 
      assert(editMode, 'Edit mode preference should be stored')
      
      // Step 3: Add a prompt pattern that aligns with preferences
      mockEntries.push({
        id: Date.now(),
        key: 'prompt_pattern:similar_task',
        project_id: projectId,
        value: JSON.stringify({
          text: 'Update single component file with small patch',
          usage_count: 1,
          success_count: 1,
          projectId
        })
      })
      
      // Step 4: Use request_router with similar input and userId
      const routeResult = await request_router({
        input: 'Update one file component with minor changes',
        projectId,
        userId,
        memoryEntries: mockEntries
      })
      
      // Step 5: Verify preference boost was applied
      assert.strictEqual(routeResult.type, 'prompt_pattern_match')
      assert(routeResult.pattern._score > 0.5, 'Pattern should have high score due to preference alignment')
      
      // Step 6: Test that preferences are specific to userId
      const otherUserResult = await request_router({
        input: 'Update one file component with minor changes',
        projectId,
        userId: 'user2', // Different user
        memoryEntries: mockEntries
      })
      
      // Should still match but without preference boost
      assert.strictEqual(otherUserResult.type, 'prompt_pattern_match')
      assert(otherUserResult.pattern._score < routeResult.pattern._score, 'Other user should not get preference boost')
    })
    
    console.log()
    
    // Summary
    console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed`)
    
    if (passedTests === totalTests) {
      console.log('🎉 All User Preference Memory tests passed!')
      return { success: true, totalTests, passedTests }
    } else {
      console.log('❌ Some tests failed')
      return { success: false, totalTests, passedTests }
    }
    
  } catch (error) {
    console.error('Test execution error:', error.message)
    return { success: false, error: error.message }
  }
}

// Run tests if called directly
if (require.main === module) {
  runTests().then(result => {
    process.exit(result.success ? 0 : 1)
  })
}

module.exports = { runTests }