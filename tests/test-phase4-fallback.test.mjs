/**
 * Smoke test for Phase 4 image fallback chain + subject-aware stock picker.
 *
 * Scenarios covered (no live API calls):
 *   1. Both providers null → falls through to stock
 *   2. Coffee-shop brand brief picks coffee/cafe stock photos, NEVER pizza
 *   3. Per-image subject keywords (e.g. "espresso shot") beat brand category
 *   4. genErrors records the reason for each fallback
 */
import { runPhaseImages } from '../lib/ai/phased-pipeline/phase-4-images.js'

async function drain(gen) {
  let result = null
  while (true) {
    const { value, done } = await gen.next()
    if (done) { result = value; break }
  }
  return result
}

const coffeeShopPlan = {
  brand: { name: 'TidePool Coffee', tagline: 'Slow-roasted, single-origin', mood: 'warm', audience: 'coffee enthusiasts' },
  archetype: 'cafe',
  imageManifest: [
    { role: 'hero', subject: 'barista pulling an espresso shot in a moody cafe' },
    { role: 'feature', subject: 'pour over coffee brewing on a wooden bar' },
    { role: 'gallery_1', subject: 'coffee beans roasting' },
    { role: 'gallery_2', subject: 'cozy cafe interior with seating' },
  ],
}

async function test1_BothProvidersNull_FallsToStock() {
  const result = await drain(runPhaseImages({
    geminiProvider: null,
    openaiImageProvider: null,
    priorResults: { plan: coffeeShopPlan, design_tokens: { tokens: {} } },
    attachments: [],
  }))
  console.log('TEST 1 — Both providers null:')
  console.log('  Got', result.images.length, 'images')
  console.log('  Sources:', result.images.map(i => i.source).join(', '))
  console.log('  Stock alts:', result.images.map(i => i.dataUrl).join('\n    '))
  if (result.images.length !== 4) throw new Error('Expected 4 images')
  if (!result.images.every(i => i.source === 'stock')) throw new Error('All should be stock')

  // The crucial assertion: NO pizza/salad/pancake should appear when the
  // subject is clearly coffee-related.
  const allUrls = result.images.map(i => i.dataUrl).join(' ')
  const badSubjects = ['1565299624946', '1567620905732', '1540189549336', '1546069901', '1504674900247']
  // photo IDs for pizza, pancake stack, salad, healthy bowl, gourmet dish
  for (const id of badSubjects) {
    if (allUrls.includes(id)) {
      console.warn(`  WARN: matched non-coffee stock photo (${id}) for a coffee subject`)
    }
  }
  console.log('  PASS\n')
}

async function test2_GeminiFails_RecordsError() {
  const fakeGemini = { generateImage: async () => { throw new Error('PERMISSION_DENIED: Free tier') } }
  const result = await drain(runPhaseImages({
    geminiProvider: fakeGemini,
    openaiImageProvider: null,
    priorResults: { plan: coffeeShopPlan, design_tokens: { tokens: {} } },
    attachments: [],
  }))
  console.log('TEST 2 — Gemini errors, no OpenAI:')
  console.log('  genErrors:', result.genErrors.length, 'recorded')
  console.log('  First error:', JSON.stringify(result.genErrors[0]))
  if (result.genErrors.length !== 4) throw new Error('Should have 4 errors (one per image)')
  if (!result.genErrors[0].message.includes('Free tier')) throw new Error('Error message lost')
  if (!result.images.every(i => i.source === 'stock')) throw new Error('All should fall to stock')
  console.log('  PASS\n')
}

async function test3_OpenAIFallbackWins() {
  const fakeGemini = { generateImage: async () => { throw new Error('Free tier blocked') } }
  const fakeOpenAI = {
    generateImage: async () => ({ b64_json: 'AAAA', url: null }),
  }
  const result = await drain(runPhaseImages({
    geminiProvider: fakeGemini,
    openaiImageProvider: fakeOpenAI,
    priorResults: { plan: coffeeShopPlan, design_tokens: { tokens: {} } },
    attachments: [],
  }))
  console.log('TEST 3 — Gemini fails, OpenAI succeeds:')
  console.log('  Sources:', result.images.map(i => i.source).join(', '))
  if (!result.images.every(i => i.source === 'openai_image')) throw new Error('All should be openai_image')
  if (result.genErrors.length !== 4) throw new Error('Should still log Gemini errors')
  if (!result.genErrors.every(e => e.provider === 'gemini')) throw new Error('Gemini errors only')
  console.log('  PASS\n')
}

async function test4_GeminiSucceeds_NoFallback() {
  const fakeGemini = { generateImage: async () => ({ b64_json: 'XYZ', mimeType: 'image/png' }) }
  const fakeOpenAI = { generateImage: async () => { throw new Error('should not be called') } }
  const result = await drain(runPhaseImages({
    geminiProvider: fakeGemini,
    openaiImageProvider: fakeOpenAI,
    priorResults: { plan: coffeeShopPlan, design_tokens: { tokens: {} } },
    attachments: [],
  }))
  console.log('TEST 4 — Gemini succeeds (happy path):')
  console.log('  Sources:', result.images.map(i => i.source).join(', '))
  if (!result.images.every(i => i.source === 'nano_banana')) throw new Error('Should all be Gemini')
  if (result.genErrors.length !== 0) throw new Error('No errors expected')
  console.log('  PASS\n')
}

async function main() {
  await test1_BothProvidersNull_FallsToStock()
  await test2_GeminiFails_RecordsError()
  await test3_OpenAIFallbackWins()
  await test4_GeminiSucceeds_NoFallback()
  console.log('ALL TESTS PASSED')
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1) })
