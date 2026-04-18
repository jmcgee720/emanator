/**
 * Tests for QuickActionChips chip data — verifies archetype wiring without
 * needing a DOM renderer. The visual component is exercised by the frontend
 * smoke test.
 */

import { GENERIC_ACTIONS, ARCHETYPE_ACTIONS } from '../../components/dashboard/QuickActionChips.jsx'

describe('QuickActionChips data', () => {
  test('GENERIC_ACTIONS has 5 chips with required shape', () => {
    expect(GENERIC_ACTIONS.length).toBe(5)
    GENERIC_ACTIONS.forEach((chip) => {
      expect(chip.id).toBeTruthy()
      expect(chip.label).toBeTruthy()
      expect(chip.prompt).toBeTruthy()
      expect(chip.icon).toBeDefined()
    })
  })

  test('every chip has a unique id', () => {
    const ids = GENERIC_ACTIONS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('ARCHETYPE_ACTIONS covers common archetypes', () => {
    const expected = ['saas_tool', 'portfolio', 'ai_app', 'ecommerce', 'marketplace', 'social_app']
    expected.forEach((key) => {
      expect(ARCHETYPE_ACTIONS[key]).toBeDefined()
      expect(ARCHETYPE_ACTIONS[key].length).toBeGreaterThan(0)
    })
  })

  test('archetype chips have proper shape', () => {
    Object.entries(ARCHETYPE_ACTIONS).forEach(([key, chips]) => {
      chips.forEach((chip) => {
        expect(chip.id).toBeTruthy()
        expect(chip.label).toBeTruthy()
        expect(chip.prompt).toBeTruthy()
        expect(chip.icon).toBeDefined()
      })
    })
  })

  test('prompts are helpful, not empty placeholders', () => {
    GENERIC_ACTIONS.forEach((chip) => {
      expect(chip.prompt.length).toBeGreaterThan(10)
    })
  })

  test('change-color and mobile-pass chips exist with the right prompts', () => {
    const changeColor = GENERIC_ACTIONS.find((c) => c.id === 'change-color')
    expect(changeColor.prompt).toMatch(/primary accent color/i)
    const mobile = GENERIC_ACTIONS.find((c) => c.id === 'mobile-pass')
    expect(mobile.prompt).toMatch(/mobile responsive/i)
  })

  test('chips have appropriate hints where open-ended', () => {
    // Chips ending in a colon or trailing space (open-ended) should have a hint
    GENERIC_ACTIONS.forEach((chip) => {
      if (chip.prompt.endsWith(' ') || chip.prompt.endsWith(': ')) {
        expect(chip.hint).toBeTruthy()
      }
    })
  })
})
