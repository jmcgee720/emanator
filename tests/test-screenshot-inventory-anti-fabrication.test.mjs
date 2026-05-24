/**
 * Tests for the anti-fabrication validator added to
 * submit_screenshot_inventory on 2026-05-24.
 *
 * User reported (Nexsara chat) that even with the gate forcing a tool
 * call, the model was fabricating section names like "App information",
 * "Test users section", "Developer contact information" on screenshots
 * that contained NONE of those literal phrases. The validator now
 * cross-references visible_elements proper-noun claims against
 * text_quotes — if a labelled claim doesn't appear in any quoted text,
 * the inventory is rejected and the model is forced to retry.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { submitScreenshotInventoryTool } from '../lib/ai/agent-tools-v2.js'

function makeTool() {
  return submitScreenshotInventoryTool([{ filename: 'test.png' }])
}

test('accepts honest inventory: labels claimed all appear in text_quotes', async () => {
  const tool = makeTool()
  const result = await tool.execute({
    inventory_per_image: [
      {
        attachment_label: 'attachment 1: test.png',
        visible_elements: [
          'Page title "OAuth Overview" at top of main column',
          'Left sidebar with items: Overview, Branding, Audience',
        ],
        text_quotes: [
          'Google Auth Platform',
          'OAuth Overview',
          'Overview',
          'Branding',
          'Audience',
          'Metrics',
        ],
        cropped_or_hidden: [],
        colors_and_states: ['Dark theme', 'Overview is highlighted blue'],
      },
    ],
    comparison_to_user_expectation: {
      user_stated_expectation: 'user has not stated an expectation on this turn',
      matches: [],
      mismatches: [],
    },
    layout_notes: 'OAuth Overview page with empty Metrics charts.',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.ok(typeof result === 'string', 'returns a string')
  assert.match(result, /Inventory recorded/i, 'accepted: ' + result.slice(0, 200))
})

test('REJECTS the 2026-05-24 Nexsara-style fabrication', async () => {
  // This is the EXACT failure pattern the user reported: chat claimed
  // to see "App information", "App domain", "Developer contact
  // information", "Test users" sections on a page whose actual text
  // quotes do not contain any of those phrases.
  const tool = makeTool()
  const result = await tool.execute({
    inventory_per_image: [
      {
        attachment_label: 'attachment 1: nexsara-screenshot.png',
        visible_elements: [
          'Publishing status: Testing displayed at top',
          'App information section visible',
          'App domain section below',
          'Developer contact information section',
          'Test users section at bottom with ADD USERS button',
        ],
        text_quotes: [
          'Google Auth Platform',
          'OAuth Overview',
          'Metrics',
          'Traffic',
          'No data is available for this project.',
        ],
        cropped_or_hidden: [],
        colors_and_states: [],
      },
    ],
    comparison_to_user_expectation: {
      user_stated_expectation: 'user wants help finding Test users',
      matches: [],
      mismatches: [],
    },
    layout_notes: 'OAuth consent screen with test users section.',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.match(result, /INVENTORY REJECTED/i, 'must reject fabricated inventory')
  assert.match(result, /Publishing|Testing|Developer/, 'rejection names some specific fabricated label')
})

test('handles empty / minimal inventories without false-positive', async () => {
  // A page that genuinely has very little text should not trip the
  // validator. visible_elements that describe geometry/state but
  // don't name labels are exempt.
  const tool = makeTool()
  const result = await tool.execute({
    inventory_per_image: [
      {
        attachment_label: 'attachment 1: blank.png',
        visible_elements: [
          'mostly empty page',
          'small spinning loader in the center of the viewport',
          'no visible buttons or text labels',
        ],
        text_quotes: [],
        cropped_or_hidden: [],
        colors_and_states: ['dark background'],
      },
    ],
    comparison_to_user_expectation: {
      user_stated_expectation: 'user has not stated an expectation on this turn',
      matches: [],
      mismatches: [],
    },
    layout_notes: 'Mostly blank loading screen.',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.match(result, /Inventory recorded/i)
})

test('partial fabrication: most claims grounded, one made up — still rejected', async () => {
  const tool = makeTool()
  const result = await tool.execute({
    inventory_per_image: [
      {
        attachment_label: 'attachment 1: real.png',
        visible_elements: [
          'OAuth Overview title at top',
          'Metrics section heading visible',
          'Test users section at bottom', // ← fabricated
        ],
        text_quotes: ['OAuth Overview', 'Metrics', 'Traffic', 'Errors'],
        cropped_or_hidden: [],
        colors_and_states: [],
      },
    ],
    comparison_to_user_expectation: {
      user_stated_expectation: 'user has not stated an expectation on this turn',
      matches: [],
      mismatches: [],
    },
    layout_notes: 'OAuth Overview',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.match(result, /INVENTORY REJECTED/i)
})

test('accepts case-insensitive label matches', async () => {
  // text_quotes may quote text in different case than visible_elements
  // describes (e.g. quote "BRANDING" but element says "Branding section").
  const tool = makeTool()
  const result = await tool.execute({
    inventory_per_image: [
      {
        attachment_label: 'attachment 1: sidebar.png',
        visible_elements: [
          'Branding navigation item in sidebar',
          'AUDIENCE label below Branding',
        ],
        text_quotes: ['branding', 'audience'],
        cropped_or_hidden: [],
        colors_and_states: [],
      },
    ],
    comparison_to_user_expectation: {
      user_stated_expectation: 'user has not stated an expectation on this turn',
      matches: [],
      mismatches: [],
    },
    layout_notes: 'sidebar',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.match(result, /Inventory recorded/i)
})

test('still catches the verdict/cropped contradiction (pre-existing guard)', async () => {
  const tool = makeTool()
  const result = await tool.execute({
    inventory_per_image: [
      {
        attachment_label: 'attachment 1: a.png',
        visible_elements: ['something honest'],
        text_quotes: ['something'],
        cropped_or_hidden: ['Top of modal is cut off'],
        colors_and_states: [],
      },
    ],
    comparison_to_user_expectation: {
      user_stated_expectation: 'user has not stated an expectation on this turn',
      matches: [],
      mismatches: [],
    },
    layout_notes: 'x',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.match(result, /INVENTORY REJECTED/i)
  assert.match(result, /contradiction|cropped/i)
})

test('still catches missing acknowledgement (pre-existing guard)', async () => {
  const tool = makeTool()
  const result = await tool.execute({
    inventory_per_image: [
      {
        attachment_label: 'attachment 1: a.png',
        visible_elements: ['something honest'],
        text_quotes: ['something'],
        cropped_or_hidden: [],
        colors_and_states: [],
      },
    ],
    comparison_to_user_expectation: {
      user_stated_expectation: 'user has not stated an expectation on this turn',
      matches: [],
      mismatches: [],
    },
    layout_notes: 'x',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: false,
  })
  assert.match(result, /acknowledgement missing/i)
})
