/**
 * Feature Planner Module Tests — comprehensive testing of post-processing functions
 * Tests the feature_planner.js module for plan correctness enforcement and single-file intent detection
 */

const { enforcePlanCorrectness, detectSingleFileIntent } = require('../../lib/self_builder/feature_planner')

// Mock console to suppress logs during tests
const originalLog = console.log
const originalWarn = console.warn
beforeEach(() => {
  console.log = jest.fn()
  console.warn = jest.fn()
})
afterEach(() => {
  console.log = originalLog
  console.warn = originalWarn
})

describe('Feature Planner Module Tests', () => {

  describe('detectSingleFileIntent()', () => {

    test('1. "modify `lib/ai/service.js` only" → returns specific file path', () => {
      const result = detectSingleFileIntent("modify `lib/ai/service.js` only")
      expect(result).toBe('lib/ai/service.js')
    })

    test('2. "update service.js" → returns filename', () => {
      const result = detectSingleFileIntent("update service.js")
      expect(result).toBe('service.js')
    })

    test('3. "fix the bug in single file route.js" → returns filename', () => {
      const result = detectSingleFileIntent("fix the bug in single file route.js")
      expect(result).toBe('route.js')
    })

    test('4. "minimal patch to openai.js" → returns filename', () => {
      const result = detectSingleFileIntent("minimal patch to openai.js")
      expect(result).toBe('openai.js')
    })

    test('5. "build a new feature across multiple files" → returns null', () => {
      const result = detectSingleFileIntent("build a new feature across multiple files")
      expect(result).toBe(null)
    })

    test('6. empty string → returns null', () => {
      const result = detectSingleFileIntent("")
      expect(result).toBe(null)
    })

    test('7. "just this file: lib/self_builder/request_router.js" → returns path', () => {
      const result = detectSingleFileIntent("just this file: lib/self_builder/request_router.js")
      expect(result).toBe('lib/self_builder/request_router.js')
    })

  })

  describe('enforcePlanCorrectness()', () => {

    test('8. Plan with missing file_actions → initialized to [], correction recorded', () => {
      const plan = { summary: "Test plan without file_actions" }
      const fileContext = { existingPaths: [], files: [] }
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions).toEqual([])
      expect(result.corrections).toContain('file_actions was missing — initialized to empty array')
    })

    test('9. Plan with file_actions: null → initialized to []', () => {
      const plan = { summary: "Test plan", file_actions: null }
      const fileContext = { existingPaths: [], files: [] }
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions).toEqual([])
      expect(result.corrections).toContain('file_actions was missing — initialized to empty array')
    })

    test('10. Plan with create on existing file → corrected to update', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/ai/service.js", action: "create", reason: "Add new feature" }
        ]
      }
      const fileContext = { 
        existingPaths: ["lib/ai/service.js"],
        files: [{ path: "lib/ai/service.js", content: "existing content" }]
      }
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions[0].action).toBe('update')
      expect(result.corrections).toContain('lib/ai/service.js: corrected create→update (file exists)')
    })

    test('11. Plan with create on non-existing file → stays create', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/new/module.js", action: "create", reason: "Add new module" }
        ]
      }
      const fileContext = { 
        existingPaths: ["lib/ai/service.js"],
        files: [{ path: "lib/ai/service.js", content: "existing content" }]
      }
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions[0].action).toBe('create')
      expect(result.corrections).not.toContain(expect.stringMatching(/lib\/new\/module\.js.*create.*update/))
    })

    test('12. Plan with update on existing file → stays update (no correction)', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/ai/service.js", action: "update", reason: "Modify feature" }
        ]
      }
      const fileContext = { 
        existingPaths: ["lib/ai/service.js"],
        files: [{ path: "lib/ai/service.js", content: "existing content" }]
      }
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions[0].action).toBe('update')
      expect(result.corrections).toHaveLength(0)
    })

    test('13. Single-file prompt + plan with 3 file_actions → trimmed to 1 matching action', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/ai/service.js", action: "update", reason: "Main change" },
          { path: "lib/other/file.js", action: "create", reason: "Side effect" },
          { path: "components/test.jsx", action: "update", reason: "Another change" }
        ]
      }
      const fileContext = { 
        existingPaths: ["lib/ai/service.js", "components/test.jsx"],
        files: []
      }
      const userMessage = "modify `lib/ai/service.js` only"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions).toHaveLength(1)
      expect(plan.file_actions[0].path).toBe('lib/ai/service.js')
      expect(result.corrections[0]).toContain('single-file enforcement: kept only lib/ai/service.js, removed 2 extra action(s)')
    })

    test('14. Single-file prompt + plan with 3 actions, target matches 2nd action → keeps 2nd action only', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/first.js", action: "update", reason: "First change" },
          { path: "lib/target.js", action: "update", reason: "Target change" },
          { path: "lib/third.js", action: "create", reason: "Third change" }
        ]
      }
      const fileContext = { 
        existingPaths: ["lib/first.js", "lib/target.js"],
        files: []
      }
      const userMessage = "edit lib/target.js only"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions).toHaveLength(1)
      expect(plan.file_actions[0].path).toBe('lib/target.js')
      expect(result.corrections[0]).toContain('single-file enforcement: kept only lib/target.js, removed 2 extra action(s)')
    })

    test('15. Multi-file prompt + plan with 3 actions → all 3 kept (no enforcement)', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/ai/service.js", action: "update", reason: "Main change" },
          { path: "lib/other/file.js", action: "create", reason: "Side effect" },
          { path: "components/test.jsx", action: "update", reason: "Another change" }
        ]
      }
      const fileContext = { 
        existingPaths: ["lib/ai/service.js", "components/test.jsx"],
        files: []
      }
      const userMessage = "build a new feature across multiple files"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions).toHaveLength(3)
      expect(result.corrections).not.toContain(expect.stringMatching(/single-file enforcement/))
    })

    test('16. Plan with placeholder in description → stripped', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { 
            path: "lib/ai/service.js", 
            action: "update", 
            description: "Add new feature, assume existing code is properly structured",
            reason: "Main change"
          }
        ]
      }
      const fileContext = { existingPaths: [], files: [] }
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions[0].description).toBe('Add new feature,   is properly structured')
      expect(result.corrections).toContain('lib/ai/service.js: stripped placeholder language from description')
    })

    test('17. Plan with placeholder in reason → stripped', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { 
            path: "lib/ai/service.js", 
            action: "update", 
            reason: "Modify existing code to add functionality"
          }
        ]
      }
      const fileContext = { existingPaths: [], files: [] }
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions[0].reason).toBe('Modify  to add functionality')
      expect(result.corrections).toContain('lib/ai/service.js: stripped placeholder language from reason')
    })

    test('18. constraints_checked updated after corrections', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/existing.js", action: "create", reason: "Change" },
          { path: "lib/new.js", action: "create", reason: "New file" }
        ],
        constraints_checked: {}
      }
      const fileContext = { 
        existingPaths: ["lib/existing.js"],
        files: [{ path: "lib/existing.js", content: "content" }]
      }
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.constraints_checked.no_illegal_create).toBe(true) // one corrected to update, one valid create
      expect(plan.constraints_checked.has_file_actions).toBe(true)
      expect(plan.constraints_checked.minimal_patch).toBe(true)
    })

    test('19. Plan with normalized path (./lib/foo.js vs lib/foo.js) → create→update correction works', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "./lib/foo.js", action: "create", reason: "Add feature" }
        ]
      }
      const fileContext = { 
        existingPaths: ["lib/foo.js"],
        files: [{ path: "lib/foo.js", content: "content" }]
      }
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions[0].action).toBe('update')
      expect(result.corrections).toContain('./lib/foo.js: corrected create→update (file exists)')
    })

    test('20. Plan with no fileContext → no crash, no create→update corrections', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/any.js", action: "create", reason: "Add feature" }
        ]
      }
      const fileContext = null
      const userMessage = "test message"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions[0].action).toBe('create') // should remain unchanged
      expect(result.corrections).not.toContain(expect.stringMatching(/corrected create.*update/))
      expect(result.corrections).toHaveLength(0)
    })

  })

  describe('Edge Cases and Integration', () => {

    test('Generic single-file signal → keeps first action only', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/first.js", action: "update", reason: "First" },
          { path: "lib/second.js", action: "create", reason: "Second" }
        ]
      }
      const fileContext = { existingPaths: [], files: [] }
      const userMessage = "single file modification needed"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions).toHaveLength(1)
      expect(plan.file_actions[0].path).toBe('lib/first.js')
      expect(result.corrections[0]).toContain('single-file enforcement: kept only lib/first.js, removed 1 extra action(s)')
    })

    test('Multiple placeholders in same field → all stripped', () => {
      const plan = {
        summary: "Test plan", 
        file_actions: [
          {
            path: "test.js",
            action: "update",
            reason: "Assume the existing code structure and add new functionality",
            intent: "// ... rest of implementation"
          }
        ]
      }
      const fileContext = { existingPaths: [], files: [] }
      const userMessage = "test"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions[0].reason).toBe('the  structure and add new functionality')
      expect(plan.file_actions[0].intent).toBe('of implementation')
      expect(result.corrections).toHaveLength(3) // 2 for reason, 1 for intent
    })

    test('Single-file intent with endsWith match → correctly identifies file', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "lib/ai/service.js", action: "update", reason: "Main" },
          { path: "components/ui/button.jsx", action: "create", reason: "Other" }
        ]
      }
      const fileContext = { existingPaths: [], files: [] }
      const userMessage = "modify service.js only"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      expect(plan.file_actions).toHaveLength(1)
      expect(plan.file_actions[0].path).toBe('lib/ai/service.js')
    })

    test('constraints_checked with illegal create detection', () => {
      const plan = {
        summary: "Test plan",
        file_actions: [
          { path: "existing.js", action: "create", reason: "Will be corrected" },
          { path: "another_existing.js", action: "create", reason: "Also will be corrected" }
        ],
        constraints_checked: {}
      }
      const fileContext = { 
        existingPaths: ["existing.js", "another_existing.js"],
        files: []
      }
      const userMessage = "test"

      const result = enforcePlanCorrectness(plan, fileContext, userMessage)

      // Both should be corrected to update, so no illegal creates remain
      expect(plan.constraints_checked.no_illegal_create).toBe(true)
      expect(plan.file_actions.every(fa => fa.action === 'update')).toBe(true)
    })

  })

})