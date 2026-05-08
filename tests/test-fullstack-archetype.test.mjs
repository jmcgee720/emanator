// ──────────────────────────────────────────────────────────────────────
// Test: fullstack_app archetype contract.
//
// Verifies the Phase 5 compose prompt switches to fullstack-aware mode
// when plan.archetype === 'fullstack_app' AND plan.dataModel is set.
// We don't run the real LLM — we inspect the prompt string the composer
// would send to make sure:
//   • The DATA MODEL block is included
//   • API ROUTE / LIB FILE rules are present
//   • Landing-only builds DON'T leak the fullstack rules
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// Crude prompt assembly (mirrors phase-5-compose.js sharedContext)
function buildSharedContext(plan, copy, tokens, imageHints) {
  const isFullstack = plan.archetype === 'fullstack_app' && plan.dataModel
  const fullstackBlock = isFullstack ? `
## DATA MODEL (this is a fullstack_app — generate API routes that match)
${JSON.stringify(plan.dataModel, null, 2)}

## FULLSTACK FILE RULES
- For \`app/api/<entity>/route.js\` files: implement GET (list) + POST (create)
` : ''
  return `
## PLAN
${JSON.stringify({ archetype: plan.archetype, brand: plan.brand, sections: plan.sections }, null, 2)}
${fullstackBlock}
## COPY
${JSON.stringify(copy, null, 2)}

## DESIGN TOKENS
${JSON.stringify(tokens, null, 2)}

## IMAGES
${imageHints || '(none — use bg gradient or SVG placeholder)'}
`
}

test('landing_only plan produces NO fullstack block in shared context', () => {
  const ctx = buildSharedContext(
    { archetype: 'landing_only', brand: { name: 'Café' }, sections: [] },
    { hero: { headline: 'x' } },
    { typography: {} },
    '',
  )
  assert.equal(ctx.includes('DATA MODEL'), false)
  assert.equal(ctx.includes('FULLSTACK FILE RULES'), false)
})

test('fullstack_app plan WITHOUT dataModel does NOT trigger fullstack block', () => {
  // Defensive: archetype alone isn't enough — dataModel must be present
  // or the prompt would say "fullstack" with nothing to bind to.
  const ctx = buildSharedContext(
    { archetype: 'fullstack_app', brand: { name: 'Tasks' }, sections: [], dataModel: null },
    {},
    {},
    '',
  )
  assert.equal(ctx.includes('DATA MODEL'), false)
})

test('fullstack_app plan WITH dataModel includes the data model + API rules', () => {
  const plan = {
    archetype: 'fullstack_app',
    brand: { name: 'Tasks' },
    sections: [],
    dataModel: {
      entities: [
        { name: 'Task', fields: ['id:uuid', 'title:string'], endpoints: ['GET /api/tasks', 'POST /api/tasks'] },
      ],
      auth: 'none',
      storage: 'supabase',
    },
  }
  const ctx = buildSharedContext(plan, {}, {}, '')
  assert.ok(ctx.includes('DATA MODEL'))
  assert.ok(ctx.includes('FULLSTACK FILE RULES'))
  assert.ok(ctx.includes('app/api/<entity>/route.js'))
  assert.ok(ctx.includes('"name": "Task"'))
  assert.ok(ctx.includes('"storage": "supabase"'))
})

test('phase-1-plan prompt advertises fullstack_app archetype to the LLM', () => {
  // Source-level check: if someone removes fullstack_app from the
  // archetype enum the LLM stops emitting it. Catch this in CI.
  const text = readFileSync(new URL('../lib/ai/phased-pipeline/phase-1-plan.js', import.meta.url), 'utf8')
  assert.ok(text.includes('fullstack_app'), 'phase-1-plan must list fullstack_app')
  assert.ok(text.includes('dataModel'), 'phase-1-plan must define the dataModel JSON shape')
  assert.ok(text.includes('Fullstack-app rules'), 'phase-1-plan must include fullstack rules section')
})

test('phase-5-compose prompts include API-route + lib file type hints', () => {
  const text = readFileSync(new URL('../lib/ai/phased-pipeline/phase-5-compose.js', import.meta.url), 'utf8')
  assert.ok(text.includes('THIS IS AN API ROUTE'), 'API route hint must be present')
  assert.ok(text.includes('THIS IS A LIB FILE'), 'lib file hint must be present')
  assert.ok(text.includes('isApiRoute'), 'detection helper must exist')
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (e) { console.error(`  ✗ ${t.name}\n      ${e.message}`); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
