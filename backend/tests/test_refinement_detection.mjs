/**
 * Test Suite: Refinement Request Detection
 * Tests the isRefinementRequest() function and related refinement patterns
 * 
 * Features tested:
 * - isRefinementRequest() correctly detects visual/content/layout change requests
 * - isRefinementRequest() correctly rejects complex requests
 * - COMPLEX_DISQUALIFIERS block refinement for backend/auth/routing requests
 */

import { isRefinementRequest, isSimpleFrontendEdit, findMainPagePath } from '../../lib/ai/intents.js';

// Test cases for refinement detection
const REFINEMENT_SHOULD_MATCH = [
  // "add X to the page/section/header/..."
  'add plants to the page',
  'add icons to the header',
  'put some decorations on the hero section',
  'insert a logo in the nav',
  'include testimonials in the footer',
  
  // "add X all over / everywhere"
  'add plants all over the page',
  'scatter some stars everywhere',
  'spread decorations throughout',
  
  // "change/update/modify the X"
  'change the background color',
  'update the font style',
  'modify the button colors',
  'adjust the spacing',
  'tweak the padding',
  'swap the header image',
  'replace the logo',
  
  // "make it/the X more/less/bigger/smaller/..."
  'make it more modern',
  'make the buttons bigger',
  'make the text larger',
  'make it cleaner',
  'make the layout simpler',
  
  // "remove/delete/hide the X"
  'remove the sidebar',
  'delete the footer section',
  'hide the navigation',
  'get rid of the border',
  
  // "move X to the top/bottom/left/right"
  'move the logo to the left',
  'shift the menu to the right',
  'reorder the sections',
  'relocate the CTA to the top',
  
  // Concise refinements
  'bigger buttons',
  'more spacing',
  'different colors',
  'new icons',
  'better shadows',
  
  // "I want / can you / please" + visual change
  'I want to add more images',
  'can you change the theme',
  'please update the colors',
  'could you make it darker',
  
  // "use a different X" / "try X instead"
  'use a different color scheme',
  'try a darker theme',
  'switch to a new font',
  'go with a different layout',
  
  // Direct style instructions
  'center the text',
  'align the buttons left',
  'set the background to blue',
  'apply a gradient',
  'give it more padding',
];

const REFINEMENT_SHOULD_NOT_MATCH = [
  // Backend/API requests (COMPLEX_DISQUALIFIERS)
  'set up authentication',
  'create a backend API',
  'add a server endpoint',
  'connect to the database',
  
  // Routing/multi-page (COMPLEX_DISQUALIFIERS)
  'add routing between pages',
  'create multiple pages',
  'add a new route',
  
  // Package/dependency requests (COMPLEX_DISQUALIFIERS)
  'install stripe for payments',
  'add npm package',
  'install a new dependency',
  'update package.json',
  
  // Database requests (COMPLEX_DISQUALIFIERS)
  'connect to mongodb',
  'set up postgres',
  'add redis caching',
  'configure supabase',
  
  // Framework-specific backend (COMPLEX_DISQUALIFIERS)
  'create an express server',
  'add a fastapi endpoint',
  'set up django',
  
  // Payment/subscription (COMPLEX_DISQUALIFIERS)
  'add stripe checkout',
  'implement payment processing',
  'add subscription billing',
  
  // Generic non-refinement requests
  'build a new app',
  'create a dashboard from scratch',
  'what is the weather today',
  'explain how React works',
];

// Run tests
console.log('=== isRefinementRequest() Test Suite ===\n');

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

// Test SHOULD MATCH cases
console.log('--- Testing SHOULD MATCH (refinement requests) ---');
for (const msg of REFINEMENT_SHOULD_MATCH) {
  const result = isRefinementRequest(msg);
  if (result === true) {
    totalPassed++;
    console.log(`✓ PASS: "${msg}"`);
  } else {
    totalFailed++;
    failures.push({ msg, expected: true, got: result });
    console.log(`✗ FAIL: "${msg}" => ${result} (expected: true)`);
  }
}

console.log('\n--- Testing SHOULD NOT MATCH (complex requests) ---');
for (const msg of REFINEMENT_SHOULD_NOT_MATCH) {
  const result = isRefinementRequest(msg);
  if (result === false) {
    totalPassed++;
    console.log(`✓ PASS: "${msg}"`);
  } else {
    totalFailed++;
    failures.push({ msg, expected: false, got: result });
    console.log(`✗ FAIL: "${msg}" => ${result} (expected: false)`);
  }
}

// Test findMainPagePath
console.log('\n--- Testing findMainPagePath() ---');
const pathTests = [
  { paths: ['app/page.jsx', 'app/layout.jsx'], expected: 'app/page.jsx' },
  { paths: ['pages/index.jsx', 'pages/_app.jsx'], expected: 'pages/index.jsx' },
  { paths: ['src/App.jsx', 'src/index.js'], expected: 'src/App.jsx' },
  { paths: ['index.html', 'styles.css'], expected: 'index.html' },
  { paths: ['random.js', 'other.css'], expected: 'app/page.jsx' }, // default
];

for (const test of pathTests) {
  const result = findMainPagePath(test.paths);
  if (result === test.expected) {
    totalPassed++;
    console.log(`✓ PASS: findMainPagePath([${test.paths.join(', ')}]) => "${result}"`);
  } else {
    totalFailed++;
    failures.push({ msg: `findMainPagePath([${test.paths.join(', ')}])`, expected: test.expected, got: result });
    console.log(`✗ FAIL: findMainPagePath([${test.paths.join(', ')}]) => "${result}" (expected: "${test.expected}")`);
  }
}

// Test isSimpleFrontendEdit (should NOT match refinement patterns)
console.log('\n--- Testing isSimpleFrontendEdit() vs refinement ---');
const simpleFrontendTests = [
  { msg: 'build a landing page for my startup', expected: true },
  { msg: 'create a dashboard', expected: true },
  { msg: 'add plants to the page', expected: false }, // refinement, not new build
  { msg: 'change the colors', expected: false }, // refinement, not new build
];

for (const test of simpleFrontendTests) {
  const result = isSimpleFrontendEdit(test.msg);
  if (result === test.expected) {
    totalPassed++;
    console.log(`✓ PASS: isSimpleFrontendEdit("${test.msg}") => ${result}`);
  } else {
    totalFailed++;
    failures.push({ msg: `isSimpleFrontendEdit("${test.msg}")`, expected: test.expected, got: result });
    console.log(`✗ FAIL: isSimpleFrontendEdit("${test.msg}") => ${result} (expected: ${test.expected})`);
  }
}

// Summary
console.log('\n=== TEST SUMMARY ===');
console.log(`Total: ${totalPassed + totalFailed} tests`);
console.log(`Passed: ${totalPassed}`);
console.log(`Failed: ${totalFailed}`);

if (failures.length > 0) {
  console.log('\n=== FAILURES ===');
  for (const f of failures) {
    console.log(`- "${f.msg}": got ${f.got}, expected ${f.expected}`);
  }
}

// Exit with appropriate code
process.exit(totalFailed > 0 ? 1 : 0);
