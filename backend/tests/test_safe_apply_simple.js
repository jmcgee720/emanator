/**
 * Safe Apply Module Comprehensive Testing (Node.js version)
 * Tests for atomic diff application with rollback protection.
 */

// Mock the database module before requiring safe_apply
const mockDb = {
  projectFiles: {
    findByPath: null,
    create: null,
    update: null,
    delete: null
  },
  fileChangeEvents: {
    create: null
  }
}

// Override require to mock the db module
const Module = require('module')
const originalRequire = Module.prototype.require

Module.prototype.require = function(id) {
  if (id === '../../lib/supabase/db') {
    return { db: mockDb }
  }
  return originalRequire.apply(this, arguments)
}

const { safeApplyDiffs, snapshotAffectedFiles, rollback } = require('../../lib/self_builder/safe_apply')

// Mock detectFileType function
const mockDetectFileType = (path) => {
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.py')) return 'python'
  return 'text'
}

const TEST_PROJECT_ID = 'test-project-123'

// Simple test helper
function createMockFunction() {
  const fn = (...args) => fn._mockReturnValue || fn._mockImplementation?.(...args)
  fn.mock = { calls: [] }
  fn._mockReturnValue = undefined
  fn._mockImplementation = null
  
  const originalFn = fn
  const wrappedFn = (...args) => {
    fn.mock.calls.push(args)
    return originalFn(...args)
  }
  
  Object.setPrototypeOf(wrappedFn, fn)
  wrappedFn.mock = fn.mock
  wrappedFn.mockResolvedValue = (value) => {
    fn._mockReturnValue = Promise.resolve(value)
    return wrappedFn
  }
  wrappedFn.mockRejectedValue = (value) => {
    fn._mockReturnValue = Promise.reject(value)
    return wrappedFn
  }
  wrappedFn.mockResolvedValueOnce = (value) => {
    const currentCalls = fn.mock.calls.length
    fn._mockImplementation = (...args) => {
      if (fn.mock.calls.length === currentCalls + 1) {
        return Promise.resolve(value)
      }
      return fn._mockReturnValue || Promise.resolve()
    }
    return wrappedFn
  }
  wrappedFn.mockRejectedValueOnce = (value) => {
    const currentCalls = fn.mock.calls.length
    fn._mockImplementation = (...args) => {
      if (fn.mock.calls.length === currentCalls + 1) {
        return Promise.reject(value)
      }
      return fn._mockReturnValue || Promise.resolve()
    }
    return wrappedFn
  }
  wrappedFn.mockImplementation = (impl) => {
    fn._mockImplementation = impl
    return wrappedFn
  }
  
  return wrappedFn
}

function resetMocks() {
  mockDb.projectFiles.findByPath = createMockFunction().mockResolvedValue(null)
  mockDb.projectFiles.create = createMockFunction().mockImplementation((file) => 
    Promise.resolve({ ...file, id: `mock-id-${Date.now()}` }))
  mockDb.projectFiles.update = createMockFunction().mockResolvedValue(undefined)
  mockDb.projectFiles.delete = createMockFunction().mockResolvedValue(undefined)
  mockDb.fileChangeEvents.create = createMockFunction().mockResolvedValue({ id: 'mock-event-id' })
}

async function runTests() {
  console.log('\n🧪 SAFE APPLY MODULE COMPREHENSIVE TESTING\n')
  
  let passed = 0
  let failed = 0
  
  async function test(name, fn) {
    resetMocks()
    try {
      await fn()
      console.log(`✅ ${name}`)
      passed++
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`)
      failed++
    }
  }

  // ============ SNAPSHOT TESTS ============
  console.log('\n📸 SNAPSHOT TESTS')
  
  await test('Test 1: 2 files, both exist → snapshot has both with content', async () => {
    mockDb.projectFiles.findByPath
      .mockResolvedValueOnce({
        id: 'file1-id',
        content: 'existing content 1',
        file_type: 'javascript',
        version: 3
      })
      .mockResolvedValueOnce({
        id: 'file2-id', 
        content: 'existing content 2',
        file_type: 'css',
        version: 1
      })

    const diffs = [
      { path: 'lib/utils.js', action: 'update' },
      { path: 'styles/main.css', action: 'update' }
    ]

    const snapshot = await snapshotAffectedFiles(TEST_PROJECT_ID, diffs)
    
    if (snapshot.size !== 2) throw new Error('Expected 2 items in snapshot')
    if (!snapshot.get('lib/utils.js')) throw new Error('Missing utils.js in snapshot')
    if (!snapshot.get('styles/main.css')) throw new Error('Missing main.css in snapshot')
  })

  await test('Test 2: 1 file exists, 1 doesn\'t → snapshot has data + null', async () => {
    mockDb.projectFiles.findByPath
      .mockResolvedValueOnce({
        id: 'existing-id',
        content: 'existing content',
        file_type: 'javascript',
        version: 2
      })
      .mockResolvedValueOnce(null)

    const diffs = [
      { path: 'existing.js', action: 'update' },
      { path: 'new.js', action: 'create' }
    ]

    const snapshot = await snapshotAffectedFiles(TEST_PROJECT_ID, diffs)
    
    if (snapshot.size !== 2) throw new Error('Expected 2 items in snapshot')
    if (!snapshot.get('existing.js')) throw new Error('Missing existing.js in snapshot')
    if (snapshot.get('new.js') !== null) throw new Error('Expected null for new.js')
  })

  await test('Test 3: Empty diffs → empty snapshot', async () => {
    const snapshot = await snapshotAffectedFiles(TEST_PROJECT_ID, [])
    
    if (snapshot.size !== 0) throw new Error('Expected empty snapshot')
    if (mockDb.projectFiles.findByPath.mock.calls.length > 0) {
      throw new Error('findByPath should not have been called')
    }
  })

  // ============ SAFE APPLY DIFF TESTS ============
  console.log('\n⚡ SAFE APPLY DIFF TESTS')

  await test('Test 4: Single create → written=[path], rolledBack=false', async () => {
    const diffs = [{
      path: 'new-file.js',
      action: 'create',
      newContent: 'console.log("new file")',
      description: 'Create new utility file'
    }]

    mockDb.projectFiles.create.mockResolvedValue({
      id: 'new-file-id',
      project_id: TEST_PROJECT_ID,
      path: 'new-file.js',
      content: 'console.log("new file")',
      file_type: 'javascript',
      version: 1
    })

    const result = await safeApplyDiffs(TEST_PROJECT_ID, diffs, mockDetectFileType)
    
    if (result.written.length !== 1 || result.written[0] !== 'new-file.js') {
      throw new Error('Expected written=[new-file.js]')
    }
    if (result.deleted.length !== 0) throw new Error('Expected no deletions')
    if (result.errors.length !== 0) throw new Error('Expected no errors')
    if (result.rolledBack !== false) throw new Error('Expected rolledBack=false')
  })

  await test('Test 5: Single update on existing file → written=[path], version incremented', async () => {
    const existingFile = {
      id: 'existing-id',
      content: 'old content',
      file_type: 'javascript',
      version: 2
    }

    mockDb.projectFiles.findByPath.mockResolvedValue(existingFile)

    const diffs = [{
      path: 'existing.js',
      action: 'update',
      newContent: 'new content',
      description: 'Update existing file'
    }]

    const result = await safeApplyDiffs(TEST_PROJECT_ID, diffs, mockDetectFileType)
    
    if (result.written.length !== 1 || result.written[0] !== 'existing.js') {
      throw new Error('Expected written=[existing.js]')
    }
    if (result.rolledBack !== false) throw new Error('Expected rolledBack=false')
    
    // Check if update was called with version increment
    if (mockDb.projectFiles.update.mock.calls.length !== 1) {
      throw new Error('Expected update to be called once')
    }
    const updateCall = mockDb.projectFiles.update.mock.calls[0]
    if (updateCall[1].version !== 3) {
      throw new Error('Expected version to be incremented to 3')
    }
  })

  await test('Test 6: Single delete → deleted=[path]', async () => {
    const existingFile = {
      id: 'to-delete-id',
      content: 'content to delete',
      file_type: 'javascript',
      version: 1
    }

    mockDb.projectFiles.findByPath.mockResolvedValue(existingFile)

    const diffs = [{
      path: 'delete-me.js',
      action: 'delete',
      description: 'Remove obsolete file'
    }]

    const result = await safeApplyDiffs(TEST_PROJECT_ID, diffs, mockDetectFileType)
    
    if (result.deleted.length !== 1 || result.deleted[0] !== 'delete-me.js') {
      throw new Error('Expected deleted=[delete-me.js]')
    }
    if (result.written.length !== 0) throw new Error('Expected no writes')
    if (result.rolledBack !== false) throw new Error('Expected rolledBack=false')
  })

  await test('Test 7: Update on missing file → auto-creates, written=[path]', async () => {
    mockDb.projectFiles.findByPath.mockResolvedValue(null)

    const diffs = [{
      path: 'missing.js',
      action: 'update',
      newContent: 'auto-created content',
      description: 'Update non-existent file'
    }]

    mockDb.projectFiles.create.mockResolvedValue({
      id: 'auto-created-id',
      project_id: TEST_PROJECT_ID,
      path: 'missing.js',
      content: 'auto-created content',
      file_type: 'javascript',
      version: 1
    })

    const result = await safeApplyDiffs(TEST_PROJECT_ID, diffs, mockDetectFileType)
    
    if (result.written.length !== 1 || result.written[0] !== 'missing.js') {
      throw new Error('Expected written=[missing.js]')
    }
    if (result.rolledBack !== false) throw new Error('Expected rolledBack=false')
    if (mockDb.projectFiles.create.mock.calls.length !== 1) {
      throw new Error('Expected create to be called once')
    }
  })

  await test('Test 8: Empty diffs → no-op result', async () => {
    const result = await safeApplyDiffs(TEST_PROJECT_ID, [], mockDetectFileType)
    
    if (result.written.length !== 0) throw new Error('Expected no writes')
    if (result.deleted.length !== 0) throw new Error('Expected no deletions')
    if (result.errors.length !== 0) throw new Error('Expected no errors')
    if (result.rolledBack !== false) throw new Error('Expected rolledBack=false')
  })

  await test('Test 9: 3 diffs all succeed → written=[3 paths], rolledBack=false', async () => {
    mockDb.projectFiles.findByPath
      .mockResolvedValueOnce(null) // For create
      .mockResolvedValueOnce({ // For update
        id: 'update-id',
        content: 'old update content',
        file_type: 'javascript',
        version: 1
      })
      .mockResolvedValueOnce({ // For delete
        id: 'delete-id',
        content: 'content to delete',
        file_type: 'css',
        version: 1
      })

    mockDb.projectFiles.create.mockResolvedValue({
      id: 'created-id',
      project_id: TEST_PROJECT_ID,
      path: 'create.js',
      content: 'created content',
      file_type: 'javascript',
      version: 1
    })

    const diffs = [
      { path: 'create.js', action: 'create', newContent: 'created content' },
      { path: 'update.js', action: 'update', newContent: 'updated content' },
      { path: 'delete.css', action: 'delete' }
    ]

    const result = await safeApplyDiffs(TEST_PROJECT_ID, diffs, mockDetectFileType)
    
    if (result.written.length !== 2) throw new Error('Expected 2 written files')
    if (result.deleted.length !== 1) throw new Error('Expected 1 deleted file')
    if (result.rolledBack !== false) throw new Error('Expected rolledBack=false')
  })

  await test('Test 10: 3 diffs, 2nd fails → rollback: written=[], deleted=[], errors=[1], rolledBack=true', async () => {
    mockDb.projectFiles.findByPath
      .mockResolvedValueOnce(null) // First create - will succeed
      .mockResolvedValueOnce({ // Second update - will fail
        id: 'update-id',
        content: 'old content',
        file_type: 'javascript',
        version: 1
      })

    mockDb.projectFiles.create.mockResolvedValueOnce({
      id: 'created-id',
      project_id: TEST_PROJECT_ID,
      path: 'first.js',
      content: 'first content',
      file_type: 'javascript',
      version: 1
    })

    mockDb.projectFiles.update.mockRejectedValueOnce(new Error('Database connection failed'))

    // Mock findByPath for rollback
    const rollbackMock = mockDb.projectFiles.findByPath
    rollbackMock.mockImplementation((projectId, path) => {
      if (path === 'first.js') {
        return Promise.resolve({ id: 'created-id' })
      }
      return Promise.resolve(null)
    })

    const diffs = [
      { path: 'first.js', action: 'create', newContent: 'first content' },
      { path: 'second.js', action: 'update', newContent: 'second content' },
      { path: 'third.js', action: 'create', newContent: 'third content' }
    ]

    const result = await safeApplyDiffs(TEST_PROJECT_ID, diffs, mockDetectFileType)
    
    if (result.written.length !== 0) throw new Error('Expected empty written array after rollback')
    if (result.deleted.length !== 0) throw new Error('Expected empty deleted array after rollback')
    if (result.errors.length !== 1) throw new Error('Expected 1 error')
    if (result.rolledBack !== true) throw new Error('Expected rolledBack=true')
  })

  await test('Test 13: Path normalization: ./lib/foo.js applied as lib/foo.js', async () => {
    const diffs = [{
      path: './lib/foo.js', // With ./ prefix
      action: 'create',
      newContent: 'normalized content',
      description: 'Test path normalization'
    }]

    mockDb.projectFiles.create.mockResolvedValue({
      id: 'normalized-id',
      project_id: TEST_PROJECT_ID,
      path: 'lib/foo.js',
      content: 'normalized content',
      file_type: 'javascript',
      version: 1
    })

    const result = await safeApplyDiffs(TEST_PROJECT_ID, diffs, mockDetectFileType)
    
    if (result.written.length !== 1 || result.written[0] !== 'lib/foo.js') {
      throw new Error('Expected normalized path lib/foo.js')
    }
    
    const createCall = mockDb.projectFiles.create.mock.calls[0][0]
    if (createCall.path !== 'lib/foo.js') {
      throw new Error('Expected create to use normalized path')
    }
  })

  // ============ ROLLBACK TESTS ============
  console.log('\n🔄 ROLLBACK TESTS')

  await test('Test 14: Rollback of created file (snapshot was null) → file deleted', async () => {
    const snapshot = new Map([
      ['new-file.js', null] // File didn't exist before
    ])
    const appliedPaths = ['new-file.js']

    mockDb.projectFiles.findByPath.mockResolvedValue({
      id: 'created-file-id',
      path: 'new-file.js'
    })

    await rollback(TEST_PROJECT_ID, snapshot, appliedPaths)
    
    if (mockDb.projectFiles.delete.mock.calls.length !== 1) {
      throw new Error('Expected delete to be called once')
    }
    if (mockDb.projectFiles.update.mock.calls.length > 0) {
      throw new Error('Expected update not to be called')
    }
  })

  await test('Test 15: Rollback of updated file → original content restored', async () => {
    const originalData = {
      id: 'existing-id',
      content: 'original content',
      file_type: 'javascript',
      version: 3
    }
    
    const snapshot = new Map([
      ['existing.js', originalData]
    ])
    const appliedPaths = ['existing.js']

    await rollback(TEST_PROJECT_ID, snapshot, appliedPaths)
    
    if (mockDb.projectFiles.update.mock.calls.length !== 1) {
      throw new Error('Expected update to be called once')
    }
    if (mockDb.projectFiles.delete.mock.calls.length > 0) {
      throw new Error('Expected delete not to be called')
    }
    
    const updateCall = mockDb.projectFiles.update.mock.calls[0]
    if (updateCall[1].content !== 'original content') {
      throw new Error('Expected original content to be restored')
    }
  })

  await test('Test 16: Rollback error (db failure) → logs but doesn\'t throw', async () => {
    const originalError = console.error
    let errorLogged = false
    console.error = () => { errorLogged = true }

    const snapshot = new Map([
      ['error-file.js', {
        id: 'error-id',
        content: 'original content',
        file_type: 'javascript',
        version: 1
      }]
    ])
    const appliedPaths = ['error-file.js']

    mockDb.projectFiles.update.mockRejectedValue(new Error('Rollback database error'))

    try {
      await rollback(TEST_PROJECT_ID, snapshot, appliedPaths)
      if (!errorLogged) throw new Error('Expected error to be logged')
    } finally {
      console.error = originalError
    }
  })

  // ============ SUMMARY ============
  console.log('\n📊 TEST RESULTS SUMMARY')
  console.log(`✅ Tests Passed: ${passed}`)
  console.log(`❌ Tests Failed: ${failed}`)
  console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`)
  
  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Safe Apply module is working correctly.')
    console.log('✅ snapshotAffectedFiles: File state capture working')
    console.log('✅ safeApplyDiffs: Atomic diff application working') 
    console.log('✅ rollback: File restoration working')
    console.log('✅ Path normalization: ./lib/foo.js → lib/foo.js')
    console.log('✅ Database mocking: CommonJS module integration working')
    console.log('✅ Error handling: Rollback protection working')
  } else {
    console.log('\n⚠️  Some tests failed. Please review the implementation.')
    process.exit(1)
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error)
  process.exit(1)
})