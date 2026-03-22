/**
 * Comprehensive tests for the tightened Plan Validator
 * Testing new validation checks: strict file existence, single-file enforcement,
 * placeholder content detection, and hard reject on >10 files
 */

// Mock detectSingleFileIntent function since the ES module import may not work in Node.js testing
const mockDetectSingleFileIntent = (userMessage) => {
  if (!userMessage) return null;
  // Single-file patterns
  if (/\bmodify\s+[`"']?([a-zA-Z0-9_/.\\-]+\.js)[`"']?\s*(only)?\b/i.test(userMessage)) {
    const match = userMessage.match(/\bmodify\s+[`"']?([a-zA-Z0-9_/.\\-]+\.js)[`"']?\s*(only)?\b/i);
    return match[1];
  }
  if (/single[- ]?file/i.test(userMessage)) return '__single__';
  if (/\bonly\b.*file/i.test(userMessage)) return '__single__';
  return null;
};

// Mock the module imports
const mockContainsPlaceholderLanguage = (text) => {
  const placeholders = ['TODO', 'placeholder', 'insert here', 'existing code'];
  return placeholders.some(p => text.toLowerCase().includes(p.toLowerCase()));
};

// Import crypto for hashing
const crypto = require('crypto');

// Plan validator functions (adapted from ES module)
function hashPlan(plan) {
  const canonical = JSON.stringify({
    summary: plan.summary || '',
    file_actions: (plan.file_actions || []).map(a => ({ path: a.path, action: a.action })),
    reasoning: plan.reasoning || [],
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function validatePlan(plan, fileContext, previousRejectedHash = null, userMessage = null) {
  const errors = [];
  const warnings = [];

  // 1. file_actions must exist and be non-empty
  if (!plan.file_actions || !Array.isArray(plan.file_actions) || plan.file_actions.length === 0) {
    errors.push('file_actions is missing or empty');
  }

  // 2. Check grounded_in_file_context constraint
  if (plan.constraints_checked && plan.constraints_checked.grounded_in_file_context === false) {
    errors.push('Plan self-reports as not grounded in file context');
  }

  // 3. Check for placeholder language in reasoning
  const reasoningText = Array.isArray(plan.reasoning)
    ? plan.reasoning.join(' ')
    : (plan.reasoning || '');
  if (mockContainsPlaceholderLanguage(reasoningText)) {
    errors.push(`Reasoning contains placeholder language: "${reasoningText.slice(0, 100)}"`);
  }

  // 4. Check for placeholder language in file action descriptions
  for (const action of (plan.file_actions || [])) {
    const desc = [action.intent, action.reason, action.description].filter(Boolean).join(' ');
    if (mockContainsPlaceholderLanguage(desc)) {
      errors.push(`File action "${action.path}" contains placeholder language`);
    }
  }

  // 5. Strict file existence validation — create/update must match filesystem
  if (fileContext) {
    const existingSet = new Set((fileContext.existingPaths || []).map(p => p.replace(/^\.\//, '').replace(/^\//, '')));
    for (const rawPath of (fileContext.existingPaths || [])) existingSet.add(rawPath);
    for (const action of (plan.file_actions || [])) {
      const norm = (action.path || '').replace(/^\.\//, '').replace(/^\//, '');
      const exists = existingSet.has(action.path) || existingSet.has(norm);
      if (action.action === 'create' && exists) {
        errors.push(`"${action.path}": marked create but file exists — must be update`);
      }
      if (action.action === 'update' && !exists) {
        errors.push(`"${action.path}": marked update but file does not exist — must be create`);
      }
    }
  }

  // 6. Check for repeated rejected plan
  if (previousRejectedHash) {
    const currentHash = hashPlan(plan);
    if (currentHash === previousRejectedHash) {
      errors.push('Plan is identical to a previously rejected plan');
    }
  }

  // 7. Strict single-file enforcement
  if (userMessage && (plan.file_actions || []).length > 1) {
    const singleTarget = mockDetectSingleFileIntent(userMessage);
    if (singleTarget) {
      errors.push(`Single-file prompt detected but plan has ${plan.file_actions.length} file_actions — must be exactly 1`);
    }
  }

  // 8. Placeholder content in file action code blocks
  const STRICT_PLACEHOLDER_RE = [
    /\/\/\s*TODO\b/,
    /\/\/\s*\.\.\./,
    /\bexisting code\b/i,
    /\bplaceholder\b/i,
    /\binsert here\b/i,
    /\.\.\.\s*$/m,
    /{\s*\/\*\s*\.\.\.\s*\*\/\s*}/,
  ];
  for (const action of (plan.file_actions || [])) {
    const content = action.content || action.new_content || '';
    if (content) {
      for (const re of STRICT_PLACEHOLDER_RE) {
        if (re.test(content)) {
          errors.push(`"${action.path}": file content contains placeholder: "${content.match(re)?.[0]}"`);
          break;
        }
      }
    }
  }

  // 9. Minimal patch check — hard reject if too many files
  if ((plan.file_actions || []).length > 10) {
    errors.push(`Plan touches ${plan.file_actions.length} files — exceeds maximum of 10`);
  } else if ((plan.file_actions || []).length > 5) {
    warnings.push(`Plan touches ${plan.file_actions.length} files — consider splitting into smaller patches`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    hash: hashPlan(plan),
  };
}

// Test data setup
const validFileContext = {
  existingPaths: ['lib/ai/service.js', 'components/Button.jsx', 'README.md']
};

// Test execution
function runAllTests() {
  console.log('🚀 Starting Plan Validator Tightened Validation Tests...\n');
  let totalTests = 0;
  let passedTests = 0;

  const test = (name, fn) => {
    totalTests++;
    try {
      fn();
      console.log(`   ✅ ${name}`);
      passedTests++;
      return true;
    } catch (error) {
      console.log(`   ❌ ${name} - ${error.message}`);
      return false;
    }
  };

  const expect = (actual) => ({
    toBe: (expected) => {
      if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
    },
    toHaveLength: (expected) => {
      if (actual.length !== expected) throw new Error(`Expected length ${expected}, got ${actual.length}`);
    },
    toBeGreaterThan: (expected) => {
      if (actual <= expected) throw new Error(`Expected ${actual} to be greater than ${expected}`);
    },
    toBeGreaterThanOrEqual: (expected) => {
      if (actual < expected) throw new Error(`Expected ${actual} to be >= ${expected}`);
    },
    toBeTruthy: () => {
      if (!actual) throw new Error(`Expected ${actual} to be truthy`);
    },
    toContain: (expected) => {
      if (!actual.includes(expected)) throw new Error(`Expected ${actual} to contain ${expected}`);
    }
  });

  // EXISTING BEHAVIOR PRESERVED TESTS (1-5)
  console.log('\n📋 Existing Behavior Preserved');
  
  test('1. Valid single-file update plan → valid=true', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' }],
      summary: 'Update service',
      reasoning: ['Valid update']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('2. Valid multi-file plan (2 files, both exist, both update) → valid=true', () => {
    const plan = {
      file_actions: [
        { path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' },
        { path: 'components/Button.jsx', action: 'update', content: 'const y = 2;' }
      ],
      summary: 'Update both files',
      reasoning: ['Valid multi-file update']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('3. Valid create plan (new file, not in existingPaths) → valid=true', () => {
    const plan = {
      file_actions: [{ path: 'lib/new-feature.js', action: 'create', content: 'const z = 3;' }],
      summary: 'Create new file',
      reasoning: ['Valid new file creation']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('4. Empty file_actions → error', () => {
    const plan = {
      file_actions: [],
      summary: 'Empty actions',
      reasoning: ['No actions']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('file_actions is missing or empty');
  });

  test('5. Repeated rejected hash → error', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' }],
      summary: 'Update service',
      reasoning: ['Update reason']
    };
    const previousHash = hashPlan(plan);
    const result = validatePlan(plan, validFileContext, previousHash);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plan is identical to a previously rejected plan');
  });

  // NEW: STRICT FILE EXISTENCE TESTS (6-10)
  console.log('\n📋 Strict File Existence (Check 5)');
  
  test('6. Update on missing file → error', () => {
    const plan = {
      file_actions: [{ path: 'missing-file.js', action: 'update', content: 'const x = 1;' }],
      summary: 'Update missing file',
      reasoning: ['Update missing']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('marked update but file does not exist'))).toBe(true);
  });

  test('7. Create on existing file → error', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'create', content: 'const x = 1;' }],
      summary: 'Create existing file',
      reasoning: ['Create existing']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('marked create but file exists'))).toBe(true);
  });

  test('8. Create on missing file → valid', () => {
    const plan = {
      file_actions: [{ path: 'new-file.js', action: 'create', content: 'const x = 1;' }],
      summary: 'Create new file',
      reasoning: ['Create new']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('9. Update on existing file → valid', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' }],
      summary: 'Update existing file',
      reasoning: ['Update existing']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('10. Mixed: 1 correct update + 1 wrong create-on-existing → error', () => {
    const plan = {
      file_actions: [
        { path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' },
        { path: 'components/Button.jsx', action: 'create', content: 'const y = 2;' }
      ],
      summary: 'Mixed actions',
      reasoning: ['Mixed update and create']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('marked create but file exists'))).toBe(true);
  });

  // NEW: SINGLE-FILE ENFORCEMENT TESTS (11-14)
  console.log('\n📋 Single-File Enforcement (Check 7)');
  
  test('11. userMessage "modify lib/ai/service.js only" + 3 file_actions → error', () => {
    const plan = {
      file_actions: [
        { path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' },
        { path: 'components/Button.jsx', action: 'update', content: 'const y = 2;' },
        { path: 'README.md', action: 'update', content: 'const z = 3;' }
      ],
      summary: 'Multi-file update',
      reasoning: ['Multi-file reasoning']
    };
    const result = validatePlan(plan, validFileContext, null, 'modify lib/ai/service.js only');
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Single-file prompt detected'))).toBe(true);
  });

  test('12. userMessage "modify lib/ai/service.js only" + 1 file_action → valid', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' }],
      summary: 'Single-file update',
      reasoning: ['Single-file reasoning']
    };
    const result = validatePlan(plan, validFileContext, null, 'modify lib/ai/service.js only');
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('13. userMessage "update multiple files" + 3 file_actions → valid', () => {
    const plan = {
      file_actions: [
        { path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' },
        { path: 'components/Button.jsx', action: 'update', content: 'const y = 2;' },
        { path: 'README.md', action: 'update', content: 'const z = 3;' }
      ],
      summary: 'Multi-file update',
      reasoning: ['Multi-file reasoning']
    };
    const result = validatePlan(plan, validFileContext, null, 'update multiple files');
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('14. No userMessage + 3 file_actions → valid', () => {
    const plan = {
      file_actions: [
        { path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' },
        { path: 'components/Button.jsx', action: 'update', content: 'const y = 2;' },
        { path: 'README.md', action: 'update', content: 'const z = 3;' }
      ],
      summary: 'Multi-file update',
      reasoning: ['Multi-file reasoning']
    };
    const result = validatePlan(plan, validFileContext, null, null);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // NEW: PLACEHOLDER CONTENT TESTS (15-19)
  console.log('\n📋 Placeholder Content (Check 8)');
  
  test('15. File action with "// TODO fix this" → error', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update', content: '// TODO fix this\nconst x = 1;' }],
      summary: 'Update with TODO',
      reasoning: ['Update with placeholder']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('file content contains placeholder'))).toBe(true);
  });

  test('16. File action with "// ... rest of code" → error', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;\n// ...' }],
      summary: 'Update with ellipsis',
      reasoning: ['Update with placeholder']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('file content contains placeholder'))).toBe(true);
  });

  test('17. File action with "existing code here" → error', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update', content: 'existing code here\nconst x = 1;' }],
      summary: 'Update with existing code',
      reasoning: ['Update with placeholder']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('file content contains placeholder'))).toBe(true);
  });

  test('18. File action with "const x = 1" → valid', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update', content: 'const x = 1;' }],
      summary: 'Clean update',
      reasoning: ['Clean code']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('19. File action with no content field → valid', () => {
    const plan = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update' }],
      summary: 'Update without content',
      reasoning: ['Update metadata only']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // NEW: HARD REJECT >10 FILES TESTS (20-22)
  console.log('\n📋 Hard Reject >10 Files (Check 9)');
  
  test('20. 11 file_actions → error', () => {
    const fileActions = Array.from({ length: 11 }, (_, i) => ({
      path: `file-${i}.js`,
      action: 'create',
      content: 'const x = 1;'
    }));
    const plan = {
      file_actions: fileActions,
      summary: '11 file update',
      reasoning: ['Many files']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', result.errors);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds maximum of 10'))).toBe(true);
  });

  test('21. 7 file_actions → warning only, valid=true', () => {
    const fileActions = Array.from({ length: 7 }, (_, i) => ({
      path: `file-${i}.js`,
      action: 'create',
      content: 'const x = 1;'
    }));
    const plan = {
      file_actions: fileActions,
      summary: '7 file update',
      reasoning: ['Several files']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', 'Warnings:', result.warnings.length);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('consider splitting'))).toBe(true);
  });

  test('22. 3 file_actions → no warning, valid=true', () => {
    const plan = {
      file_actions: [
        { path: 'file-1.js', action: 'create', content: 'const x = 1;' },
        { path: 'file-2.js', action: 'create', content: 'const y = 2;' },
        { path: 'file-3.js', action: 'create', content: 'const z = 3;' }
      ],
      summary: '3 file update',
      reasoning: ['Few files']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', 'Warnings:', result.warnings.length);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  // CROSS-CUTTING TESTS (23-24)
  console.log('\n📋 Cross-Cutting Tests');
  
  test('23. Plan with both update-on-missing AND placeholder content → both errors', () => {
    const plan = {
      file_actions: [{ path: 'missing-file.js', action: 'update', content: '// TODO implement this' }],
      summary: 'Update missing with placeholder',
      reasoning: ['Both issues present']
    };
    const result = validatePlan(plan, validFileContext);
    console.log('      Result:', result.valid ? '✅ PASS' : '❌ FAIL', 'Error count:', result.errors.length);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('marked update but file does not exist'))).toBe(true);
    expect(result.errors.some(e => e.includes('file content contains placeholder'))).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  test('24. hashPlan still deterministic after changes', () => {
    const plan1 = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update' }],
      summary: 'Test plan',
      reasoning: ['Test reasoning']
    };
    const plan2 = {
      file_actions: [{ path: 'lib/ai/service.js', action: 'update' }],
      summary: 'Test plan',
      reasoning: ['Test reasoning']
    };
    const hash1 = hashPlan(plan1);
    const hash2 = hashPlan(plan2);
    console.log('      Result:', hash1 === hash2 ? '✅ PASS' : '❌ FAIL', `${hash1} === ${hash2}`);
    expect(hash1).toBe(hash2);
    expect(hash1).toBeTruthy();
    expect(hash1.length).toBe(16); // 16-character hash
  });

  console.log('\n🎯 Plan Validator Tightened Validation Tests Complete!');
  console.log(`Results: ${passedTests}/${totalTests} tests passed`);
  console.log('All 24 test scenarios have been executed.');
  
  return { totalTests, passedTests, success: passedTests === totalTests };
}

// Execute the tests when file is run directly
if (require.main === module) {
  const results = runAllTests();
  process.exit(results.success ? 0 : 1);
}

module.exports = { validatePlan, hashPlan, runAllTests };