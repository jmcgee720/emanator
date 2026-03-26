/**
 * PlanValidator E2E Phase 12 Step 3 Test Suite
 * Tests the 4 new validation checks added to plan-validator.js validatePlan():
 * 1. Duplicate file paths detection
 * 2. Invalid action values check  
 * 3. Empty/missing path validation
 * 4. No-op update detection
 * 
 * Also verifies all existing checks are preserved.
 */

// Mock file-context-loader.js
jest.mock('../../lib/ai/file-context-loader.js', () => ({
  containsPlaceholderLanguage: (text) => {
    if (!text) return false
    const patterns = [/\bassume\b/i, /\bexisting code\b/i, /\bplaceholder\b/i, /\binsert here\b/i, /\.\.\.\s*$/m, /\/\/\s*\.\.\.\s*(rest|remaining|other)/i]
    return patterns.some(p => p.test(text))
  }
}))

// Mock feature_planner  
jest.mock('../../lib/self_builder/feature_planner', () => ({
  detectSingleFileIntent: (msg) => {
    if (/\b(only|just)\s+(this|one|that|the)\s+file\b/i.test(msg)) return '__single__'
    const match = msg.match(/\b(modify|update|edit|fix|patch|change)\s+[`"']?([a-zA-Z0-9_/.\\-]+\.[a-z]{1,4})[`"']?\b/i)
    if (match) return match[2]
    return null
  }
}))

import { validatePlan, hashPlan, validatePatchGrounding, validateTaskMode, validateRequestModeOutput } from '../../lib/ai/plan-validator.js'

describe('PlanValidator Phase 12 Step 3 - Enhanced Validation', () => {
  
  // Test 1: Missing file_actions
  describe('1. Missing file_actions', () => {
    test('should reject plan with no file_actions', () => {
      const plan = {}
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('file_actions is missing or empty')
    })

    test('should reject plan with null file_actions', () => {
      const plan = { file_actions: null }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('file_actions is missing or empty')
    })

    test('should reject plan with empty file_actions array', () => {
      const plan = { file_actions: [] }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('file_actions is missing or empty')
    })
  })

  // Test 2: Duplicate file paths (NEW CHECK)
  describe('2. Duplicate file paths detection', () => {
    test('should reject duplicate exact paths', () => {
      const plan = {
        file_actions: [
          { path: 'a.js', action: 'update' },
          { path: 'a.js', action: 'update' }
        ]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('duplicate path'))).toBe(true)
    })

    test('should reject normalized duplicate paths', () => {
      const plan = {
        file_actions: [
          { path: './a.js', action: 'update' },
          { path: 'a.js', action: 'update' }
        ]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('duplicate path'))).toBe(true)
    })
  })

  // Test 3: Create action on existing file
  describe('3. Create action on existing file', () => {
    test('should reject create on existing file', () => {
      const plan = {
        file_actions: [{ path: 'existing.js', action: 'create' }]
      }
      const fileContext = { existingPaths: ['existing.js'], files: [] }
      const result = validatePlan(plan, fileContext)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('marked create but file exists'))).toBe(true)
    })
  })

  // Test 4: Update action on missing file
  describe('4. Update action on missing file', () => {
    test('should reject update on non-existent file', () => {
      const plan = {
        file_actions: [{ path: 'new.js', action: 'update' }]
      }
      const fileContext = { existingPaths: [], files: [] }
      const result = validatePlan(plan, fileContext)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('marked update but file does not exist'))).toBe(true)
    })
  })

  // Test 5: Multi-file output for single-file request
  describe('5. Single-file enforcement', () => {
    test('should reject multi-file plan for single-file request', () => {
      const plan = {
        file_actions: [
          { path: 'a.js', action: 'update' },
          { path: 'b.js', action: 'update' }
        ]
      }
      const userMessage = 'modify only this file a.js'
      const result = validatePlan(plan, null, null, userMessage)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('Single-file prompt detected'))).toBe(true)
    })
  })

  // Test 6: No-op update detection (NEW CHECK)
  describe('6. No-op update detection', () => {
    test('should reject no-op update with identical content', () => {
      const plan = {
        file_actions: [{ 
          path: 'a.js', 
          action: 'update',
          content: 'const x = 1'
        }]
      }
      const fileContext = { 
        existingPaths: ['a.js'],
        files: [{ path: 'a.js', exists: true, content: 'const x = 1' }]
      }
      const result = validatePlan(plan, fileContext)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('no-op update'))).toBe(true)
    })

    test('should handle new_content field for no-op detection', () => {
      const plan = {
        file_actions: [{ 
          path: 'a.js', 
          action: 'update',
          new_content: '  const x = 1  '
        }]
      }
      const fileContext = { 
        existingPaths: ['a.js'],
        files: [{ path: 'a.js', exists: true, content: 'const x = 1' }]
      }
      const result = validatePlan(plan, fileContext)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('no-op update'))).toBe(true)
    })
  })

  // Test 7: Invalid action values (NEW CHECK)
  describe('7. Invalid action values', () => {
    test('should reject invalid action "rename"', () => {
      const plan = {
        file_actions: [{ path: 'a.js', action: 'rename' }]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('invalid action "rename"'))).toBe(true)
    })

    test('should reject empty action', () => {
      const plan = {
        file_actions: [{ path: 'a.js', action: '' }]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('invalid action ""'))).toBe(true)
    })

    test('should reject undefined action', () => {
      const plan = {
        file_actions: [{ path: 'a.js', action: undefined }]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('invalid action'))).toBe(true)
    })
  })

  // Test 8: Empty/missing path validation (NEW CHECK)
  describe('8. Empty/missing path validation', () => {
    test('should reject empty path', () => {
      const plan = {
        file_actions: [{ path: '', action: 'create' }]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('empty or missing path'))).toBe(true)
    })

    test('should reject missing path key', () => {
      const plan = {
        file_actions: [{ action: 'create' }]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('empty or missing path'))).toBe(true)
    })

    test('should reject null path', () => {
      const plan = {
        file_actions: [{ path: null, action: 'create' }]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('empty or missing path'))).toBe(true)
    })
  })

  // Test 9: Valid plan passes
  describe('9. Valid plan validation', () => {
    test('should pass valid create plan', () => {
      const plan = {
        file_actions: [{ path: 'new.js', action: 'create' }]
      }
      const fileContext = { existingPaths: [], files: [] }
      const result = validatePlan(plan, fileContext)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    test('should pass valid update plan with different content', () => {
      const plan = {
        file_actions: [{ 
          path: 'existing.js', 
          action: 'update',
          content: 'const y = 2'
        }]
      }
      const fileContext = { 
        existingPaths: ['existing.js'],
        files: [{ path: 'existing.js', exists: true, content: 'const x = 1' }]
      }
      const result = validatePlan(plan, fileContext)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  // Test 10: Minimal patch enforcement
  describe('10. File count limits', () => {
    test('should reject plans with >10 files', () => {
      const file_actions = Array.from({length: 11}, (_, i) => ({
        path: `file${i}.js`,
        action: 'create'
      }))
      const plan = { file_actions }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('exceeds maximum of 10'))).toBe(true)
    })

    test('should warn for 6-10 files but pass', () => {
      const file_actions = Array.from({length: 6}, (_, i) => ({
        path: `file${i}.js`,
        action: 'create'
      }))
      const plan = { file_actions }
      const result = validatePlan(plan)
      expect(result.valid).toBe(true)
      expect(result.warnings.some(w => w.includes('consider splitting'))).toBe(true)
    })

    test('should pass ≤5 files without warning', () => {
      const file_actions = Array.from({length: 3}, (_, i) => ({
        path: `file${i}.js`,
        action: 'create'
      }))
      const plan = { file_actions }
      const result = validatePlan(plan)
      expect(result.valid).toBe(true)
      expect(result.warnings).toEqual([])
    })
  })

  // Test 11: Placeholder language in reasoning
  describe('11. Placeholder language validation', () => {
    test('should reject placeholder in reasoning', () => {
      const plan = {
        file_actions: [{ path: 'test.js', action: 'create' }],
        reasoning: ['assume existing code stays the same']
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('Reasoning contains placeholder language'))).toBe(true)
    })
  })

  // Test 12: Placeholder content in file actions
  describe('12. Placeholder content in file actions', () => {
    test('should reject TODO placeholder', () => {
      const plan = {
        file_actions: [{ 
          path: 'a.js', 
          action: 'create',
          content: '// TODO implement this'
        }]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('file content contains placeholder'))).toBe(true)
    })

    test('should reject ellipsis placeholder', () => {
      const plan = {
        file_actions: [{ 
          path: 'a.js', 
          action: 'create',
          content: 'function test() {\n  // ... rest of code\n}'
        }]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('file content contains placeholder'))).toBe(true)
    })
  })

  // Test 13: Repeated rejected plan
  describe('13. Repeated plan detection', () => {
    test('should reject plan with same hash as previously rejected', () => {
      const plan = {
        file_actions: [{ path: 'test.js', action: 'create' }],
        summary: 'Create test file'
      }
      const planHash = hashPlan(plan)
      const result = validatePlan(plan, null, planHash)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('identical to a previously rejected plan'))).toBe(true)
    })
  })

  // Test 14: Hash determinism
  describe('14. Plan hash determinism', () => {
    test('should produce same hash for identical plans', () => {
      const plan1 = {
        file_actions: [{ path: 'test.js', action: 'create' }],
        summary: 'Create test'
      }
      const plan2 = {
        file_actions: [{ path: 'test.js', action: 'create' }],
        summary: 'Create test'
      }
      expect(hashPlan(plan1)).toBe(hashPlan(plan2))
    })

    test('should produce different hashes for different plans', () => {
      const plan1 = {
        file_actions: [{ path: 'test1.js', action: 'create' }]
      }
      const plan2 = {
        file_actions: [{ path: 'test2.js', action: 'create' }]
      }
      expect(hashPlan(plan1)).not.toBe(hashPlan(plan2))
    })
  })

  // Test 15: validateTaskMode
  describe('15. Task mode validation', () => {
    test('should reject inspect mode with file actions', () => {
      const result = validateTaskMode('inspect', { hasFileActions: true })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('inspect mode must not produce file_actions')
    })

    test('should reject plan mode with file content', () => {
      const result = validateTaskMode('plan', { hasFileContent: true })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('plan mode must not produce file contents — only file_actions are allowed')
    })

    test('should reject apply mode without pending diff status', () => {
      const result = validateTaskMode('apply', { diffStatus: 'complete' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('apply mode requires metadata.diffStatus === "pending"')
    })

    test('should pass valid task modes', () => {
      expect(validateTaskMode('inspect', { hasFileActions: false }).valid).toBe(true)
      expect(validateTaskMode('plan', { hasFileContent: false }).valid).toBe(true)
      expect(validateTaskMode('apply', { diffStatus: 'pending' }).valid).toBe(true)
    })
  })

  // Test 16: validateRequestModeOutput
  describe('16. Request mode validation', () => {
    test('should reject read_only_report with proposed plan', () => {
      const result = validateRequestModeOutput('read_only_report', { hasProposedPlan: true })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('read_only_report must not produce Proposed Plan')
    })

    test('should reject apply_pending_diff with file actions', () => {
      const result = validateRequestModeOutput('apply_pending_diff', { hasFileActions: true })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('apply_pending_diff must not produce file_actions')
    })

    test('should reject discard_pending_diff with proposed plan', () => {
      const result = validateRequestModeOutput('discard_pending_diff', { hasProposedPlan: true })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('discard_pending_diff must not produce Proposed Plan')
    })

    test('should pass valid request modes', () => {
      expect(validateRequestModeOutput('read_only_report', { hasProposedPlan: false }).valid).toBe(true)
      expect(validateRequestModeOutput('apply_pending_diff', { hasFileActions: false }).valid).toBe(true)
      expect(validateRequestModeOutput('discard_pending_diff', { hasProposedPlan: false }).valid).toBe(true)
    })
  })

  // Test 17: validatePatchGrounding
  describe('17. Patch grounding validation', () => {
    test('should reject no-op patch', () => {
      const diffEntries = [{
        path: 'test.js',
        action: 'update',
        newContent: 'const x = 1',
        oldContent: 'const x = 1'
      }]
      const result = validatePatchGrounding(diffEntries)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('patch is a no-op'))).toBe(true)
    })

    test('should reject placeholder in new content', () => {
      const diffEntries = [{
        path: 'test.js',
        action: 'create',
        newContent: 'function test() {\n  // assume existing code here\n}'
      }]
      const result = validatePatchGrounding(diffEntries)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('contains placeholder language'))).toBe(true)
    })

    test('should pass valid patch', () => {
      const diffEntries = [{
        path: 'test.js',
        action: 'create',
        newContent: 'const x = 1\nconsole.log(x)'
      }]
      const result = validatePatchGrounding(diffEntries)
      expect(result.valid).toBe(true)
    })
  })

  // Test 18: Error metadata format
  describe('18. Return format validation', () => {
    test('should return proper metadata format', () => {
      const plan = {
        file_actions: [{ path: 'test.js', action: 'create' }]
      }
      const result = validatePlan(plan)
      
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('warnings')  
      expect(result).toHaveProperty('hash')
      
      expect(typeof result.valid).toBe('boolean')
      expect(Array.isArray(result.errors)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)
      expect(typeof result.hash).toBe('string')
      expect(result.hash).toHaveLength(16)
    })
  })

  // Test 19: Multiple validation errors
  describe('19. Multiple validation errors', () => {
    test('should report multiple errors in single plan', () => {
      const plan = {
        file_actions: [
          { path: 'test1.js', action: 'invalid_action' }, // invalid action  
          { path: 'test2.js', action: 'create', content: '// TODO implement' } // placeholder content
        ]
      }
      const result = validatePlan(plan)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(2)
      expect(result.errors.some(e => e.includes('invalid action'))).toBe(true)
      expect(result.errors.some(e => e.includes('placeholder'))).toBe(true)
    })
  })

  // Test 20: Edge cases
  describe('20. Edge cases', () => {
    test('should handle plan with valid actions correctly', () => {
      const plan = {
        file_actions: [
          { path: 'new.js', action: 'create', content: 'const x = 1' },
          { path: 'existing.js', action: 'update', content: 'const y = 2' },
          { path: 'old.js', action: 'delete' }
        ]
      }
      const fileContext = { 
        existingPaths: ['existing.js', 'old.js'],
        files: [
          { path: 'existing.js', exists: true, content: 'const z = 3' },
          { path: 'old.js', exists: true, content: 'old content' }
        ]
      }
      const result = validatePlan(plan, fileContext)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    test('should handle normalized paths in fileContext', () => {
      const plan = {
        file_actions: [{ path: './src/test.js', action: 'update', content: 'new content' }]
      }
      const fileContext = {
        existingPaths: ['src/test.js'],
        files: [{ path: 'src/test.js', exists: true, content: 'old content' }]
      }
      const result = validatePlan(plan, fileContext)
      expect(result.valid).toBe(true)
    })
  })
})