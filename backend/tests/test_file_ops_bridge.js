/**
 * Comprehensive test suite for File Ops Bridge module
 * Tests all exported functions: normalizePath, buildPlanActionMap, resolveAction, buildPendingDiffs
 * 
 * Test Cases:
 * - normalizePath: 4 test cases (1-4)
 * - buildPlanActionMap: 3 test cases (5-7)  
 * - resolveAction: 9 test cases (8-16)
 * - buildPendingDiffs: 7 test cases (17-23)
 */

const { 
  normalizePath, 
  buildPlanActionMap, 
  resolveAction, 
  buildPendingDiffs 
} = require('../../lib/self_builder/file_ops_bridge.js')

// Test utilities
function createMockFindExisting(files) {
  return (path) => files[path] || null
}

function createMockDetectFileType() {
  return (path) => {
    if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
    if (path.endsWith('.css')) return 'css'
    if (path.endsWith('.html')) return 'html'
    return 'text'
  }
}

// Test runner
function runTests() {
  let totalTests = 0
  let passedTests = 0
  const results = []

  function assert(condition, message) {
    totalTests++
    if (condition) {
      passedTests++
      console.log(`✅ ${message}`)
      results.push({ test: message, status: 'PASSED' })
    } else {
      console.log(`❌ ${message}`)
      results.push({ test: message, status: 'FAILED' })
    }
  }

  function assertEqual(actual, expected, message) {
    assert(actual === expected, `${message} (expected: ${expected}, actual: ${actual})`)
  }

  function assertDeepEqual(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} (expected: ${JSON.stringify(expected)}, actual: ${JSON.stringify(actual)})`)
  }

  console.log('🧪 Starting File Ops Bridge comprehensive tests...\n')

  // ==================== normalizePath Tests (Cases 1-4) ====================
  console.log('📁 Testing normalizePath function:')
  
  // Test Case 1: Remove leading ./
  assertEqual(normalizePath('./lib/foo.js'), 'lib/foo.js', 'Test 1: normalizePath removes leading ./')
  
  // Test Case 2: Remove leading /
  assertEqual(normalizePath('/lib/foo.js'), 'lib/foo.js', 'Test 2: normalizePath removes leading /')
  
  // Test Case 3: No change needed
  assertEqual(normalizePath('lib/foo.js'), 'lib/foo.js', 'Test 3: normalizePath leaves clean path unchanged')
  
  // Test Case 4: Empty string
  assertEqual(normalizePath(''), '', 'Test 4: normalizePath handles empty string')

  console.log('')

  // ==================== buildPlanActionMap Tests (Cases 5-7) ====================
  console.log('🗺️  Testing buildPlanActionMap function:')
  
  // Test Case 5: Plan with 2 actions
  const plan1 = [
    { path: 'lib/foo.js', action: 'create' },
    { path: 'lib/bar.js', action: 'update' }
  ]
  const map1 = buildPlanActionMap(plan1)
  assert(map1.get('lib/foo.js') === 'create' && map1.get('lib/bar.js') === 'update', 'Test 5: buildPlanActionMap creates map with both paths')
  
  // Test Case 6: Plan with ./ path creates both entries
  const plan2 = [{ path: './lib/foo.js', action: 'create' }]
  const map2 = buildPlanActionMap(plan2)
  assert(map2.get('./lib/foo.js') === 'create' && map2.get('lib/foo.js') === 'create', 'Test 6: buildPlanActionMap handles ./ paths creating both raw and normalized entries')
  
  // Test Case 7: Null/undefined plan
  const map3 = buildPlanActionMap(null)
  const map4 = buildPlanActionMap(undefined)
  assert(map3.size === 0 && map4.size === 0, 'Test 7: buildPlanActionMap handles null/undefined plan returning empty map')

  console.log('')

  // ==================== resolveAction Tests (Cases 8-16) ====================
  console.log('⚡ Testing resolveAction function:')
  
  // Test Case 8: Plan says 'create', file doesn't exist
  const planMap8 = new Map([['lib/new.js', 'create']])
  const findExisting8 = createMockFindExisting({})
  assertEqual(resolveAction('lib/new.js', planMap8, findExisting8, 'create_files'), 'create', 'Test 8: Plan create + file not exists → create')
  
  // Test Case 9: Plan says 'create', file EXISTS (cross-check override)
  const planMap9 = new Map([['lib/existing.js', 'create']])
  const findExisting9 = createMockFindExisting({ 'lib/existing.js': { content: 'existing' } })
  assertEqual(resolveAction('lib/existing.js', planMap9, findExisting9, 'create_files'), 'update', 'Test 9: Plan create + file exists → update (cross-check override)')
  
  // Test Case 10: Plan says 'update', file exists
  const planMap10 = new Map([['lib/existing.js', 'update']])
  const findExisting10 = createMockFindExisting({ 'lib/existing.js': { content: 'existing' } })
  assertEqual(resolveAction('lib/existing.js', planMap10, findExisting10, 'update_files'), 'update', 'Test 10: Plan update + file exists → update')
  
  // Test Case 11: Plan says 'update', file doesn't exist (cross-check override)
  const planMap11 = new Map([['lib/missing.js', 'update']])
  const findExisting11 = createMockFindExisting({})
  assertEqual(resolveAction('lib/missing.js', planMap11, findExisting11, 'update_files'), 'create', 'Test 11: Plan update + file not exists → create (cross-check override)')
  
  // Test Case 12: Plan says 'delete'
  const planMap12 = new Map([['lib/delete.js', 'delete']])
  const findExisting12 = createMockFindExisting({ 'lib/delete.js': { content: 'existing' } })
  assertEqual(resolveAction('lib/delete.js', planMap12, findExisting12, 'update_files'), 'delete', 'Test 12: Plan delete → delete (regardless of existence)')
  
  // Test Case 13: No plan entry, file exists
  const planMap13 = new Map()
  const findExisting13 = createMockFindExisting({ 'lib/existing.js': { content: 'existing' } })
  assertEqual(resolveAction('lib/existing.js', planMap13, findExisting13, 'create_files'), 'update', 'Test 13: No plan + file exists → update')
  
  // Test Case 14: No plan entry, file missing, toolName='create_files'
  const planMap14 = new Map()
  const findExisting14 = createMockFindExisting({})
  assertEqual(resolveAction('lib/new.js', planMap14, findExisting14, 'create_files'), 'create', 'Test 14: No plan + file missing + create_files → create')
  
  // Test Case 15: No plan entry, file missing, toolName='update_files'
  const planMap15 = new Map()
  const findExisting15 = createMockFindExisting({})
  assertEqual(resolveAction('lib/new.js', planMap15, findExisting15, 'update_files'), 'update', 'Test 15: No plan + file missing + update_files → update')
  
  // Test Case 16: Path normalization matching
  const planMap16 = new Map([['./lib/foo.js', 'create'], ['lib/foo.js', 'create']])  // Both entries from buildPlanActionMap
  const findExisting16 = createMockFindExisting({})
  assertEqual(resolveAction('lib/foo.js', planMap16, findExisting16, 'create_files'), 'create', 'Test 16: Path normalization - plan has ./lib/foo.js, query with lib/foo.js matches')

  console.log('')

  // ==================== buildPendingDiffs Tests (Cases 17-23) ====================
  console.log('🔄 Testing buildPendingDiffs function:')
  
  // Test Case 17: 2 files, plan has correct actions
  const toolFiles17 = [
    { path: 'lib/foo.js', content: 'new content', description: 'Added foo' },
    { path: 'lib/bar.js', content: 'bar content', description: 'Added bar' }
  ]
  const planFileActions17 = [
    { path: 'lib/foo.js', action: 'create' },
    { path: 'lib/bar.js', action: 'update' }
  ]
  const findExisting17 = createMockFindExisting({ 'lib/bar.js': { content: 'old bar' } })
  const detectFileType17 = createMockDetectFileType()
  
  const diffs17 = buildPendingDiffs(toolFiles17, {
    planFileActions: planFileActions17,
    findExisting: findExisting17,
    toolName: 'create_files',
    detectFileType: detectFileType17
  })
  
  assert(diffs17.length === 2, 'Test 17a: buildPendingDiffs returns 2 diffs')
  assert(diffs17[0].action === 'create' && diffs17[1].action === 'update', 'Test 17b: buildPendingDiffs matches plan actions')
  assert(diffs17[0].path === 'lib/foo.js' && diffs17[1].path === 'lib/bar.js', 'Test 17c: buildPendingDiffs has correct paths')
  
  // Test Case 18: File with plan='create' but findExisting returns record (cross-check)
  const toolFiles18 = [{ path: 'lib/existing.js', content: 'new content', description: 'Update existing' }]
  const planFileActions18 = [{ path: 'lib/existing.js', action: 'create' }]
  const findExisting18 = createMockFindExisting({ 'lib/existing.js': { content: 'old content' } })
  
  const diffs18 = buildPendingDiffs(toolFiles18, {
    planFileActions: planFileActions18,
    findExisting: findExisting18,
    toolName: 'create_files',
    detectFileType: createMockDetectFileType()
  })
  
  assertEqual(diffs18[0].action, 'update', 'Test 18: buildPendingDiffs cross-check - plan create + file exists → update')
  
  // Test Case 19: Empty toolFiles
  const diffs19 = buildPendingDiffs([], {
    planFileActions: [],
    findExisting: createMockFindExisting({}),
    toolName: 'create_files',
    detectFileType: createMockDetectFileType()
  })
  
  assertEqual(diffs19.length, 0, 'Test 19: buildPendingDiffs handles empty toolFiles')
  
  // Test Case 20: Paths are normalized in output
  const toolFiles20 = [{ path: './lib/foo.js', content: 'content', description: 'test' }]
  const diffs20 = buildPendingDiffs(toolFiles20, {
    planFileActions: [],
    findExisting: createMockFindExisting({}),
    toolName: 'create_files',
    detectFileType: createMockDetectFileType()
  })
  
  assertEqual(diffs20[0].path, 'lib/foo.js', 'Test 20: buildPendingDiffs normalizes paths in output (removes ./)')
  
  // Test Case 21: oldContent populated from findExisting, newContent from tool
  const toolFiles21 = [{ path: 'lib/test.js', content: 'new content', description: 'test' }]
  const findExisting21 = createMockFindExisting({ 'lib/test.js': { content: 'old content' } })
  const diffs21 = buildPendingDiffs(toolFiles21, {
    planFileActions: [],
    findExisting: findExisting21,
    toolName: 'update_files',
    detectFileType: createMockDetectFileType()
  })
  
  assert(diffs21[0].newContent === 'new content' && diffs21[0].oldContent === 'old content', 'Test 21: buildPendingDiffs populates oldContent from findExisting, newContent from tool')
  
  // Test Case 22: description falls back chain
  const toolFiles22a = [{ path: 'lib/a.js', content: 'content', description: 'primary desc' }]
  const toolFiles22b = [{ path: 'lib/b.js', content: 'content', changes: 'fallback changes' }]
  const toolFiles22c = [{ path: 'lib/c.js', content: 'content' }]  // No description or changes
  
  const opts22 = {
    planFileActions: [],
    findExisting: createMockFindExisting({}),
    toolName: 'create_files',
    detectFileType: createMockDetectFileType()
  }
  
  const diffs22a = buildPendingDiffs(toolFiles22a, opts22)
  const diffs22b = buildPendingDiffs(toolFiles22b, opts22)
  const diffs22c = buildPendingDiffs(toolFiles22c, opts22)
  
  assert(
    diffs22a[0].description === 'primary desc' && 
    diffs22b[0].description === 'fallback changes' && 
    diffs22c[0].description === '', 
    'Test 22: buildPendingDiffs description fallback: file.description → file.changes → empty string'
  )
  
  // Test Case 23: fileType uses file.file_type if present, otherwise detectFileType
  const toolFiles23a = [{ path: 'lib/test.js', content: 'content', file_type: 'typescript' }]  // explicit type
  const toolFiles23b = [{ path: 'lib/test.js', content: 'content' }]  // no explicit type, use detectFileType
  
  const diffs23a = buildPendingDiffs(toolFiles23a, opts22)
  const diffs23b = buildPendingDiffs(toolFiles23b, opts22)
  
  assert(
    diffs23a[0].fileType === 'typescript' && 
    diffs23b[0].fileType === 'javascript',  // detected from .js extension
    'Test 23: buildPendingDiffs fileType uses file.file_type if present, otherwise detectFileType'
  )

  console.log('')

  // ==================== Summary ====================
  console.log('📊 Test Summary:')
  console.log(`Total tests run: ${totalTests}`)
  console.log(`Tests passed: ${passedTests}`)
  console.log(`Tests failed: ${totalTests - passedTests}`)
  console.log(`Success rate: ${Math.round(passedTests / totalTests * 100)}%`)

  if (passedTests === totalTests) {
    console.log('\n🎉 ALL TESTS PASSED! File Ops Bridge module is fully functional.')
  } else {
    console.log('\n❌ Some tests failed. Review the output above.')
  }

  return {
    totalTests,
    passedTests,
    failedTests: totalTests - passedTests,
    successRate: Math.round(passedTests / totalTests * 100),
    results
  }
}

// Export for use as module or run directly
if (require.main === module) {
  runTests()
} else {
  module.exports = { runTests }
}