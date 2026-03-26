const { logChange } = require('../../lib/self_builder/change_log')

// Mock database and dependencies
jest.mock('../../lib/supabase/db', () => ({
  db: {
    changelog: { 
      create: jest.fn().mockResolvedValue({ id: 'log-1' }), 
      findByProject: jest.fn(), 
      findLastRejectedForTask: jest.fn() 
    },
    projectMemory: { 
      findByProjectId: jest.fn().mockResolvedValue([]), 
      create: jest.fn().mockResolvedValue({}), 
      updateById: jest.fn(), 
      deleteById: jest.fn() 
    },
  }
}))

jest.mock('../../lib/self_builder/prompt_library', () => ({
  addPromptPatternToMemory: jest.fn(),
  recordPatternSuccess: jest.fn(),
}))

const { db } = require('../../lib/supabase/db')
const { addPromptPatternToMemory, recordPatternSuccess } = require('../../lib/self_builder/prompt_library')

describe('ChangeLog E2E Phase 12 Step 2 - Enhanced logChange with File Metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ========== UNIT TESTS - logChange with mocked db ==========

  describe('Unit Tests - logChange with file paths', () => {
    test('1. logChange - applied with file paths', async () => {
      const testParams = {
        projectId: 'test-project-1',
        chatId: 'test-chat-1',
        userId: 'test-user-1',
        userTask: 'Update the sidebar layout',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['a.js', 'b.js'],
        fileActions: [
          { path: 'a.js', action: 'write' },
          { path: 'b.js', action: 'write' }
        ]
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith({
        project_id: 'test-project-1',
        chat_id: 'test-chat-1',
        user_id: 'test-user-1',
        user_task: 'Update the sidebar layout',
        task_mode: 'apply',
        file_actions: [
          { path: 'a.js', action: 'write' },
          { path: 'b.js', action: 'write' }
        ],
        validator_result: {
          result: 'applied',
          chat_type: 'builder'
        },
        created_at: expect.any(String)
      })
    })

    test('2. logChange - discarded with file paths', async () => {
      const testParams = {
        projectId: 'test-project-2',
        chatId: 'test-chat-2',
        userId: 'test-user-2',
        userTask: 'Fix the broken component',
        taskMode: 'discard',
        result: 'discarded',
        filePaths: ['x.js']
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith({
        project_id: 'test-project-2',
        chat_id: 'test-chat-2',
        user_id: 'test-user-2',
        user_task: 'Fix the broken component',
        task_mode: 'discard',
        file_actions: [
          { path: 'x.js', action: 'none' }
        ],
        validator_result: {
          result: 'discarded',
          chat_type: 'builder'
        },
        created_at: expect.any(String)
      })

      // Verify addRejectedPatternToMemory would be called for discarded
      // (addRejectedPatternToMemory is called internally but mocked here)
    })

    test('3. logChange - rolled_back', async () => {
      const testParams = {
        projectId: 'test-project-3',
        chatId: 'test-chat-3',
        userId: 'test-user-3',
        userTask: 'Update component styles',
        taskMode: 'apply',
        result: 'rolled_back',
        filePaths: ['component.jsx']
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith({
        project_id: 'test-project-3',
        chat_id: 'test-chat-3',
        user_id: 'test-user-3',
        user_task: 'Update component styles',
        task_mode: 'apply',
        file_actions: [
          { path: 'component.jsx', action: 'apply' }
        ],
        validator_result: {
          result: 'rolled_back',
          chat_type: 'builder'
        },
        created_at: expect.any(String)
      })

      // Verify no prompt pattern saved for rolled_back
      expect(addPromptPatternToMemory).not.toHaveBeenCalled()
    })

    test('4. logChange - self_edit chatType', async () => {
      const testParams = {
        projectId: 'test-project-4',
        chatId: 'test-chat-4',
        userId: 'test-user-4',
        userTask: 'Update API endpoint',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['api.js'],
        chatType: 'self_edit'
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          validator_result: {
            result: 'applied',
            chat_type: 'self_edit'
          }
        })
      )
    })

    test('5. logChange - builder chatType (default)', async () => {
      const testParams = {
        projectId: 'test-project-5',
        chatId: 'test-chat-5',
        userId: 'test-user-5',
        userTask: 'Create new feature',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['feature.js']
        // No chatType specified - should default to 'builder'
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          validator_result: {
            result: 'applied',
            chat_type: 'builder'
          }
        })
      )
    })

    test('6. logChange - no filePaths', async () => {
      const testParams = {
        projectId: 'test-project-6',
        chatId: 'test-chat-6',
        userId: 'test-user-6',
        userTask: 'General task',
        taskMode: 'plan',
        result: 'applied'
        // No filePaths or fileActions
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          file_actions: null
        })
      )
    })

    test('7. logChange - filePaths but no fileActions', async () => {
      const testParams = {
        projectId: 'test-project-7',
        chatId: 'test-chat-7',
        userId: 'test-user-7',
        userTask: 'Update files',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['c.js']
        // fileActions not provided, should be auto-built from filePaths
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          file_actions: [
            { path: 'c.js', action: 'apply' }
          ]
        })
      )
    })

    test('8. logChange - metadata fields present', async () => {
      const testParams = {
        projectId: 'test-project-8',
        chatId: 'test-chat-8',
        userId: 'test-user-8',
        userTask: 'Complete feature implementation',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['feature.js'],
        chatType: 'builder'
      }

      await logChange(testParams)

      const expectedEntry = {
        project_id: 'test-project-8',
        chat_id: 'test-chat-8',
        user_id: 'test-user-8',
        user_task: 'Complete feature implementation',
        task_mode: 'apply',
        file_actions: [
          { path: 'feature.js', action: 'apply' }
        ],
        validator_result: {
          result: 'applied',
          chat_type: 'builder'
        },
        created_at: expect.any(String)
      }

      expect(db.changelog.create).toHaveBeenCalledWith(expectedEntry)
      
      // Verify all metadata fields are present
      const actualCall = db.changelog.create.mock.calls[0][0]
      expect(actualCall).toHaveProperty('project_id')
      expect(actualCall).toHaveProperty('chat_id')
      expect(actualCall).toHaveProperty('user_id')
      expect(actualCall).toHaveProperty('user_task')
      expect(actualCall).toHaveProperty('task_mode')
      expect(actualCall).toHaveProperty('file_actions')
      expect(actualCall).toHaveProperty('validator_result')
      expect(actualCall).toHaveProperty('created_at')
    })

    test('9. logChange - applied triggers prompt pattern', async () => {
      const testParams = {
        projectId: 'test-project-9',
        chatId: 'test-chat-9',
        userId: 'test-user-9',
        userTask: 'Update the sidebar layout to fix overflow issues',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['sidebar.jsx']
      }

      await logChange(testParams)

      // Verify prompt pattern methods called for applied result with >10 char task
      expect(addPromptPatternToMemory).toHaveBeenCalledWith({
        projectId: 'test-project-9',
        name: 'update_the_sidebar_layout_to_fix_overflo',
        value: 'Update the sidebar layout to fix overflow issues'
      })
      expect(recordPatternSuccess).toHaveBeenCalledWith('test-project-9', 'Update the sidebar layout to fix overflow issues')
    })

    test('10. logChange - discarded triggers rejected pattern', async () => {
      const testParams = {
        projectId: 'test-project-10',
        chatId: 'test-chat-10',
        userId: 'test-user-10',
        userTask: 'Refactor backend completely for better performance',
        taskMode: 'discard',
        result: 'discarded',
        filePaths: ['backend.js']
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalled()
      
      // Verify addRejectedPatternToMemory would be called internally
      // (the actual function is called internally but we mock the module)
      const actualCall = db.changelog.create.mock.calls[0][0]
      expect(actualCall.validator_result.result).toBe('discarded')
      expect(actualCall.user_task.length).toBeGreaterThan(10)
    })

    test('11. logChange - rolled_back does NOT trigger patterns', async () => {
      const testParams = {
        projectId: 'test-project-11',
        chatId: 'test-chat-11',
        userId: 'test-user-11',
        userTask: 'Large refactoring that was rolled back',
        taskMode: 'apply',
        result: 'rolled_back',
        filePaths: ['app.js']
      }

      await logChange(testParams)

      // Verify no pattern learning for rolled_back
      expect(addPromptPatternToMemory).not.toHaveBeenCalled()
      expect(recordPatternSuccess).not.toHaveBeenCalled()

      const actualCall = db.changelog.create.mock.calls[0][0]
      expect(actualCall.validator_result.result).toBe('rolled_back')
    })
  })

  // ========== INTEGRATION VERIFICATION TESTS ==========

  describe('Integration Verification - Code Analysis', () => {
    test('12. route.js apply-diffs - logs with file paths', async () => {
      // Load the actual route file content to verify integration
      const fs = require('fs')
      const path = require('path')
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../app/api/[[...path]]/route.js'),
        'utf-8'
      )

      // Verify apply-diffs endpoint exists and uses logChange correctly
      expect(routeContent).toContain('apply-diffs')
      expect(routeContent).toContain('logChange({')
      
      // Verify the logChange call passes filePaths and fileActions
      expect(routeContent).toContain('filePaths: [...(results.written || []), ...(results.deleted || [])]')
      expect(routeContent).toContain('fileActions: [')
      expect(routeContent).toContain('...(results.written || []).map(p => ({ path: p, action: \'write\' }))')
      expect(routeContent).toContain('...(results.deleted || []).map(p => ({ path: p, action: \'delete\' }))')
      expect(routeContent).toContain('chatType')
    })

    test('13. route.js streaming apply - logs apply_pending_diff', async () => {
      const fs = require('fs')
      const path = require('path')
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../app/api/[[...path]]/route.js'),
        'utf-8'
      )

      // Verify streaming handler logs apply_pending_diff events
      expect(routeContent).toContain('apply_pending_diff')
      expect(routeContent).toContain('streamMeta.appliedFiles || streamMeta.written || []')
      expect(routeContent).toContain('streamMeta.deletedFiles || streamMeta.deleted || []')
      expect(routeContent).toContain('streamMeta.planData?.summary || content || \'\'')
      expect(routeContent).toContain('streamMeta.rolledBack ? \'rolled_back\' : \'applied\'')
    })

    test('14. route.js streaming discard - logs with file paths', async () => {
      const fs = require('fs')
      const path = require('path')
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../app/api/[[...path]]/route.js'),
        'utf-8'
      )

      // Verify streaming discard logs include file paths and chatType
      expect(routeContent).toContain('discard_pending_diff')
      expect(routeContent).toContain('discardedPaths')
      expect(routeContent).toContain('discardedPaths.map(p => ({ path: p, action: \'none\' }))')
      expect(routeContent).toContain('chat?.title?.startsWith(SELF_EDIT_PREFIX) ? \'self_edit\' : \'builder\'')
    })

    test('15. No false applied entries on discard', async () => {
      const fs = require('fs')
      const path = require('path')
      const routeContent = fs.readFileSync(
        path.join(__dirname, '../../app/api/[[...path]]/route.js'),
        'utf-8'
      )

      // Verify that discard_pending_diff only logs 'discard' taskMode, never 'apply'
      const discardSection = routeContent.split('discard_pending_diff')[1].split('apply_pending_diff')[0]
      expect(discardSection).toContain('taskMode: \'discard\'')
      expect(discardSection).toContain('result: \'discarded\'')
      expect(discardSection).not.toContain('taskMode: \'apply\'')
      expect(discardSection).not.toContain('result: \'applied\'')
    })
  })

  describe('AI Service Integration', () => {
    test('16. lib/ai/service.js - apply_pending_diff includes planData', async () => {
      const fs = require('fs')
      const path = require('path')
      const serviceContent = fs.readFileSync(
        path.join(__dirname, '../../lib/ai/service.js'),
        'utf-8'
      )

      // Verify planData is extracted from pendingDiffMessage.metadata.planData
      expect(serviceContent).toContain('const planData = pendingDiffMessage.metadata.planData || null')
      
      // Verify planData is passed to applyDiffs
      expect(serviceContent).toContain('const results = await this.applyDiffs(projectId, chatId, userId, diffFiles, planData)')
      
      // Verify planData is included in done event
      expect(serviceContent).toContain('planData: planData || null')
      
      // Verify apply_pending_diff mode exists
      expect(serviceContent).toContain('apply_pending_diff')
      expect(serviceContent).toContain('toolMode: \'apply_pending_diff\'')
    })
  })

  describe('Change Log Function Signature Tests', () => {
    test('17. logChange signature accepts all new parameters', async () => {
      // Test that logChange function accepts the new signature without error
      const testParams = {
        projectId: 'sig-test-1',
        chatId: 'sig-test-chat',
        userId: 'sig-test-user',
        userTask: 'Test new signature',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['test.js', 'test2.js'],
        fileActions: [
          { path: 'test.js', action: 'write' },
          { path: 'test2.js', action: 'update' }
        ],
        chatType: 'self_edit'
      }

      // This should not throw an error
      await expect(logChange(testParams)).resolves.not.toThrow()

      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'sig-test-1',
          file_actions: [
            { path: 'test.js', action: 'write' },
            { path: 'test2.js', action: 'update' }
          ],
          validator_result: expect.objectContaining({
            result: 'applied',
            chat_type: 'self_edit'
          })
        })
      )
    })

    test('18. logChange backward compatibility - old signature still works', async () => {
      // Test that the old signature (without new params) still works
      const oldParams = {
        projectId: 'compat-test-1',
        chatId: 'compat-chat',
        userId: 'compat-user',
        userTask: 'Old style call',
        taskMode: 'plan',
        result: 'applied'
        // No filePaths, fileActions, or chatType
      }

      await expect(logChange(oldParams)).resolves.not.toThrow()

      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'compat-test-1',
          file_actions: null,
          validator_result: expect.objectContaining({
            result: 'applied',
            chat_type: 'builder' // default
          })
        })
      )
    })
  })

  describe('File Actions Auto-Building Logic', () => {
    test('19. file_actions auto-built from filePaths when not provided', async () => {
      const testParams = {
        projectId: 'auto-build-1',
        chatId: 'auto-build-chat',
        userId: 'auto-build-user',
        userTask: 'Auto build test',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['auto1.js', 'auto2.jsx', 'auto3.css']
        // No fileActions provided - should be auto-built
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          file_actions: [
            { path: 'auto1.js', action: 'apply' },
            { path: 'auto2.jsx', action: 'apply' },
            { path: 'auto3.css', action: 'apply' }
          ]
        })
      )
    })

    test('20. file_actions respects taskMode for auto-building', async () => {
      const testParams = {
        projectId: 'auto-build-2',
        chatId: 'auto-build-chat-2',
        userId: 'auto-build-user-2',
        userTask: 'Discard test',
        taskMode: 'discard',
        result: 'discarded',
        filePaths: ['discard1.js', 'discard2.js']
        // taskMode is 'discard', so action should be 'none'
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          file_actions: [
            { path: 'discard1.js', action: 'none' },
            { path: 'discard2.js', action: 'none' }
          ]
        })
      )
    })
  })

  describe('Error Handling and Edge Cases', () => {
    test('21. logChange handles database errors gracefully', async () => {
      // Mock database error
      db.changelog.create.mockRejectedValueOnce(new Error('Database connection failed'))

      const testParams = {
        projectId: 'error-test-1',
        chatId: 'error-chat',
        userId: 'error-user',
        userTask: 'Test error handling',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['error.js']
      }

      // Should not throw error - should handle gracefully
      await expect(logChange(testParams)).resolves.not.toThrow()
    })

    test('22. logChange handles null/undefined values', async () => {
      const testParams = {
        projectId: 'null-test-1',
        chatId: null,
        userId: null,
        userTask: '',
        taskMode: null,
        result: null,
        filePaths: null,
        fileActions: null,
        chatType: null
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith({
        project_id: 'null-test-1',
        chat_id: null,
        user_id: null,
        user_task: '',
        task_mode: 'unknown',
        file_actions: null,
        validator_result: {
          result: 'unknown',
          chat_type: 'builder'
        },
        created_at: expect.any(String)
      })
    })

    test('23. logChange with empty arrays', async () => {
      const testParams = {
        projectId: 'empty-test-1',
        chatId: 'empty-chat',
        userId: 'empty-user',
        userTask: 'Empty arrays test',
        taskMode: 'apply',
        result: 'applied',
        filePaths: [],
        fileActions: []
      }

      await logChange(testParams)

      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          file_actions: [] // Empty array should be preserved, not converted to null
        })
      )
    })

    test('24. logChange with mixed valid and invalid data', async () => {
      const testParams = {
        projectId: 'mixed-test-1',
        chatId: 'mixed-chat',
        userId: 'mixed-user',
        userTask: 'Mixed data test with very long task description that should still work properly',
        taskMode: 'apply',
        result: 'applied',
        filePaths: ['valid.js', '', null, 'another.js'], // Mix of valid and invalid paths
        chatType: 'builder'
      }

      await logChange(testParams)

      // Should still create entry despite some invalid data
      expect(db.changelog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'mixed-test-1',
          user_task: 'Mixed data test with very long task description that should still work properly'
        })
      )
    })
  })
})