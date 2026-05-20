// ──────────────────────────────────────────────────────────────────────
// Provider-billing error classifier — distinguishes from app credits
// ──────────────────────────────────────────────────────────────────────
// User reported a misleading UX bug: Auroraly chat showed "You're out
// of credits. Tap Buy Credits in the sidebar" while the credit balance
// in the top bar showed 1091.90. Root cause: errors.js was conflating
// UPSTREAM provider billing errors (Anthropic API spending cap,
// Emergent Universal Key budget exhausted) with the user's APP credit
// balance. Tapping "Buy Credits" would top up Auroraly credits, which
// were not the problem.
//
// These tests pin that the classifier now distinguishes the two cases
// and surfaces the correct provider-specific guidance.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyProviderError } from '../lib/ai/errors.js'

test('provider_billing: does NOT mention "Buy Credits" sidebar button', () => {
  const e = classifyProviderError(
    { status: 402, message: 'Insufficient credit balance on your account' },
    'anthropic',
    'claude-sonnet-4-5-20250929',
  )
  assert.equal(e.error_type, 'provider_billing', 'must use provider_billing type, not generic billing')
  assert.ok(!/Tap \*\*Buy Credits\*\* in the sidebar/.test(e.user_message), 'must NOT instruct user to tap Buy Credits — that buys app credits, not provider quota')
})

test('provider_billing: explicitly says "this is not your Auroraly credit balance"', () => {
  const e = classifyProviderError(
    { status: 402, message: 'You exceeded your current quota, please check your plan' },
    'openai',
    'gpt-4o',
  )
  assert.match(e.user_message, /not your Auroraly credit balance/i, 'must explicitly disambiguate from app credits')
})

test('provider_billing: names the actual provider (Anthropic / OpenAI / etc) in the message', () => {
  const eAnthropic = classifyProviderError(
    { status: 402, message: 'billing error' },
    'anthropic',
    'claude-sonnet-4-5-20250929',
  )
  assert.match(eAnthropic.user_message, /Anthropic/, 'must name Anthropic when that is the provider')
  assert.match(eAnthropic.user_message, /Anthropic billing dashboard/, 'must direct user to the correct dashboard')

  const eOpenAI = classifyProviderError(
    { status: 402, message: 'billing error' },
    'openai',
    'gpt-4o',
  )
  assert.match(eOpenAI.user_message, /OpenAI/, 'must name OpenAI when that is the provider')
  assert.match(eOpenAI.user_message, /OpenAI billing dashboard/, 'must direct user to the correct dashboard')
})

test('proxy_budget: detected via exact "Budget has been exceeded" format', () => {
  const e = classifyProviderError(
    { status: 402, message: 'Budget has been exceeded! Current cost: 9.87, Max budget: 10.00' },
    'anthropic',
    'claude-sonnet-4-5-20250929',
  )
  assert.equal(e.error_type, 'proxy_budget')
  assert.match(e.user_message, /\$10\.00/, 'must echo the max budget')
  assert.match(e.user_message, /\$9\.87/, 'must echo the current cost')
  assert.match(e.user_message, /Profile → Universal Key → Add Balance/)
})

test('proxy_budget: detected via looser Universal Key wording', () => {
  // Catches variants like the proxy returning a slightly different
  // error shape — the regex falls back to keyword matching so users
  // still get a Universal-Key-specific message.
  const e = classifyProviderError(
    { status: 402, message: 'The Universal Key budget for this account has been exhausted.' },
    'anthropic',
    'claude-sonnet-4-5-20250929',
  )
  assert.equal(e.error_type, 'proxy_budget', 'must classify as proxy_budget via fallback regex')
  assert.match(e.user_message, /Universal Key/)
  assert.match(e.user_message, /Auroraly app credits are unaffected/, 'must reassure user about their app credits')
})

test('proxy_budget: always reassures the user their app credits are unaffected', () => {
  const exact = classifyProviderError(
    { status: 402, message: 'Budget has been exceeded! Current cost: 5.00, Max budget: 5.00' },
    'anthropic',
    'claude-sonnet-4-5-20250929',
  )
  const loose = classifyProviderError(
    { status: 402, message: 'universal key exhausted' },
    'anthropic',
    'claude-sonnet-4-5-20250929',
  )
  for (const e of [exact, loose]) {
    assert.match(e.user_message, /Auroraly.*unaffected/i, 'every proxy_budget message must reassure about app credits')
  }
})

test('regression: generic billing error never returns the old "Tap Buy Credits" message', () => {
  // Hit every keyword path that landed in the old generic branch.
  const variants = [
    { status: 402, message: 'billing problem' },
    { status: null, message: 'insufficient_quota: please add credit balance' },
    { status: null, message: 'You exceeded your current quota' },
    { status: null, message: 'plan limit reached' },
    { status: null, message: 'payment required for this model' },
  ]
  for (const v of variants) {
    const e = classifyProviderError(v, 'anthropic', 'claude-sonnet-4-5-20250929')
    assert.ok(
      !/Tap \*\*Buy Credits\*\* in the sidebar to top up and keep building/.test(e.user_message),
      `regression: variant "${v.message}" must NOT produce the old misleading message. Got: ${e.user_message}`,
    )
  }
})
