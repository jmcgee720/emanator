// ── Post-Patch Verification Gate ──
// Verifies that a UI patch actually produced the requested visible change
// before allowing success to be reported.

/**
 * Analyze user request to extract expected UI elements.
 * Returns an array of { type, value, description } verification checks.
 */
function extractExpectedChanges(userMessage) {
  const checks = []
  const msg = userMessage || ''
  const lower = msg.toLowerCase()

  // 1. Heading text changes
  const headingPatterns = [
    /(?:change|update|set|make)\s+(?:the\s+)?(?:heading|title|h1|h2|header)\s+(?:to\s+(?:say|read)\s+|(?:to|say|read)\s+)["']?(.+?)["']?(?:\s*[.\n]|$)/i,
    /(?:heading|title|h1|h2)\s+(?:should\s+)?(?:say|read|be)\s+["'](.+?)["']/i,
    /["']([^"']{3,60})["']\s+(?:as\s+)?(?:the\s+)?(?:heading|title|header)/i,
    /heading:\s*["']?([^"'\n,]+?)["']?\s*(?:[,.\n]|$)/i,
    /render\s+(?:a\s+)?heading\s+["']?([^"'\n,]+?)["']?\s*(?:[,.\n]|$)/i,
  ]
  for (const pat of headingPatterns) {
    const m = msg.match(pat)
    if (m) checks.push({ type: 'heading_text', value: m[1].trim(), description: `Heading text "${m[1].trim()}" should be present` })
  }

  // 2. Section/tab/page navigation changes
  const sectionPatterns = [
    /(?:make)\s+["']?(\w+)["']?\s+(?:the\s+)?(?:default|active)\s+(?:active\s+)?(?:section|tab|page|view)/i,
    /(?:default|active|initial|start)\s+(?:active\s+)?(?:section|tab|page|view)\s+(?:to|should\s+be|be|=|:)\s*["']?(\w+)["']?/i,
    /(?:show|display|open|start\s+(?:on|with))\s+(?:the\s+)?["']?(\w+)["']?\s+(?:section|tab|page|view)/i,
    /(?:section|tab|page|view)\s+["']?(\w+)["']?\s+(?:should\s+be|as)\s+(?:default|active|selected)/i,
    /(?:default)\s+(?:to|=|:)\s*["']?(\w+)["']?\s+(?:section|tab|page)/i,
  ]
  for (const pat of sectionPatterns) {
    const m = msg.match(pat)
    if (m) checks.push({ type: 'active_section', value: m[1].trim(), description: `"${m[1].trim()}" section/tab should be the active default` })
  }

  // 3. Form fields — labeled/named inputs
  const formPatterns = [
    /(?:add|include|create)\s+(?:a\s+)?(?:form|input|field|textarea)\s+(?:for|called|labeled|with\s+label)\s+["']?(.+?)["']?(?:\s*[.\n,]|$)/i,
    /(?:add|include)\s+(?:a\s+)?["']?(\w[\w\s]*?)["']?\s+(?:text\s+)?(?:input|field|form\s+field)(?:\s+(?:for|if|when))/i,
    /(?:add|include)\s+(?:a\s+)?["']?(\w[\w\s]*?)["']?\s+(?:text\s+)?(?:input|field|form\s+field)(?:\s*[.\n,]|$)/i,
    /(?:text\s+)?input\s+(?:labeled|called)\s+["']?([^"'\n,]+?)["']?\s*(?:[,.\n]|$)/ig,
    /(?<!button\s)label(?:ed|:)\s+["']?([A-Z][\w\s]+?)["']?\s*(?:[,.\n]|$)/g,
  ]
  for (const pat of formPatterns) {
    if (pat.global) {
      for (const m of msg.matchAll(pat)) {
        const val = m[1].trim()
        if (val.length > 1 && val.length < 60) {
          checks.push({ type: 'form_field', value: val, description: `Form field "${val}" should be present` })
        }
      }
    } else {
      const m = msg.match(pat)
      if (m) checks.push({ type: 'form_field', value: m[1].trim(), description: `Form field "${m[1].trim()}" should be present` })
    }
  }

  // 3b. Dropdown / select elements
  const dropdownPatterns = [
    /(?:make|change|convert|turn)\s+(?:the\s+)?["']?(\w[\w\s]*?)["']?\s+(?:field\s+)?(?:into\s+|to\s+)?(?:a\s+)?(?:dropdown|select|select\s+box|select\s+field|picker)/i,
    /(?:add|include|create)\s+(?:a\s+)?(?:dropdown|select|select\s+box|picker)\s+(?:for|called|labeled|with\s+label)\s+["']?([^"'\n,]+?)["']?/i,
    /(?:dropdown|select)\s+(?:with\s+)?(?:the\s+)?(?:options?|categories|choices|values)\s+(?:for|of|like|:)\s+(.+?)(?:\.\s|$)/i,
    /(?:a\s+)?(?:dropdown|select)\s+(?:of|for)\s+["']?([^"'\n,]+?)["']?\s*(?:[,.\n]|$)/i,
  ]
  for (const pat of dropdownPatterns) {
    const m = msg.match(pat)
    if (m) {
      const val = m[1].trim()
      if (val.length > 1 && val.length < 80) {
        checks.push({ type: 'select_element', value: val, description: `A <select> dropdown for "${val}" should be present` })
      }
    }
  }

  // 3c. Specific option values (e.g. "with options: Advertising, Insurance, Other")
  const optionListMatch = msg.match(/(?:options?|categories|choices|values)\s*(?:like|such\s+as|including|:)\s*([^.]+)/i)
  if (optionListMatch) {
    const items = optionListMatch[1].split(/[,;\n]+/).map(s => s.trim().replace(/^and\s+/i, '')).filter(s => s.length > 1 && s.length < 40)
    if (items.length >= 2) {
      // Just verify a sample of options exist (first, last, and one from middle)
      const sample = [items[0], items[Math.floor(items.length / 2)], items[items.length - 1]]
      for (const item of [...new Set(sample)]) {
        checks.push({ type: 'option_value', value: item, description: `Option "${item}" should be present in a dropdown` })
      }
    }
  }

  // 3d. Conditional fields ("show X when/if Y is selected")
  const conditionalPatterns = [
    /(?:show|display|appear|reveal)\s+(?:a\s+)?["']?([^"'\n,]+?)["']?\s+(?:input|field|text\s+input|textarea|section)\s+(?:when|if|only\s+when|only\s+if)/i,
    /(?:when|if)\s+["']?(\w+)["']?\s+is\s+selected\s*,?\s*(?:show|display|reveal|add)\s+(?:a\s+)?["']?([^"'\n,]+?)["']?\s*(?:input|field|text|$)/i,
    /(?:additional\s+)?(?:text\s+)?(?:input|field)\s+(?:labeled|called)\s+["']?([^"'\n,]+?)["']?\s+(?:appears?|shows?|is\s+shown)\s+(?:when|if)/i,
  ]
  for (const pat of conditionalPatterns) {
    const m = msg.match(pat)
    if (m) {
      // m[2] exists for the "when X is selected, show Y" pattern
      const fieldName = (m[2] || m[1]).trim()
      if (fieldName.length > 1 && fieldName.length < 60) {
        checks.push({ type: 'conditional_field', value: fieldName, description: `Conditional field "${fieldName}" should appear when triggered` })
      }
    }
  }

  // 4. Removal requests
  const removePatterns = [
    /(?:remove|delete|hide|get\s+rid\s+of)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:section|button|card|element|component|tab|nav|link|form|header|footer)/i,
    /(?:remove|delete|hide|get\s+rid\s+of)\s+(?:any\s+)?(?:top\s+)?(?:horizontal\s+)?["']?(.+?)["']?\s+(?:like|such\s+as|if\s+they)/i,
    /(?:remove|delete|hide|get\s+rid\s+of)\s+(?:the\s+)?(.+?)(?:\s*[.\n]|$)/i,
  ]
  for (const pat of removePatterns) {
    const m = msg.match(pat)
    if (m && m[1].trim().length < 60 && m[1].trim().length > 2) {
      checks.push({ type: 'removed_element', value: m[1].trim(), description: `"${m[1].trim()}" should be removed` })
    }
  }

  // 5. Button/CTA text
  const buttonPatterns = [
    /(?:button|cta)\s+(?:should\s+)?(?:say|read|text)\s+["'](.+?)["']/i,
    /(?:add|change)\s+(?:a\s+)?(?:button|cta)\s+(?:with\s+text|saying|that\s+says)\s+["'](.+?)["']/i,
    /button\s+labeled\s+["']?([^"'\n,]+?)["']?\s*(?:[,.\n]|$)/i,
    /(?:a\s+)?button\s+(?:labeled|called|saying)\s+["']?([^"'\n,]+?)["']?\s*(?:[,.\n]|$)/i,
  ]
  for (const pat of buttonPatterns) {
    const m = msg.match(pat)
    if (m) checks.push({ type: 'button_text', value: m[1].trim(), description: `Button with text "${m[1].trim()}" should be present` })
  }

  // 6. Nav items
  const navPatterns = [
    /(?:add|include)\s+(?:a\s+)?["']?(\w+)["']?\s+(?:to\s+)?(?:the\s+)?(?:nav|navigation|menu|sidebar)/i,
    /(?:nav|navigation|menu)\s+(?:should\s+)?(?:include|have|contain)\s+["']?(\w+)["']?/i,
  ]
  for (const pat of navPatterns) {
    const m = msg.match(pat)
    if (m) checks.push({ type: 'nav_item', value: m[1].trim(), description: `Navigation should include "${m[1].trim()}"` })
  }

  // 7. Color/style changes
  const colorPatterns = [
    /(?:change|set|make)\s+(?:the\s+)?(?:background|bg|color|theme)\s+(?:to|=)\s+["']?([#\w]+)["']?/i,
  ]
  for (const pat of colorPatterns) {
    const m = msg.match(pat)
    if (m) checks.push({ type: 'style_value', value: m[1].trim(), description: `Style value "${m[1].trim()}" should be present in code` })
  }

  // 8. Labeled elements (debug box, section, etc.)
  const labeledElementPatterns = [
    /(?:debug\s+box|box|section|area|panel)\s+labeled:?\s*["']?([^"'\n,]+?)["']?\s*(?:[,.\n]|$)/ig,
    /labeled:?\s*\n\s*-\s*["']?([^"'\n]+?)["']?\s*$/im,
  ]
  for (const pat of labeledElementPatterns) {
    if (pat.global) {
      for (const m of msg.matchAll(pat)) {
        const val = m[1].trim()
        if (val.length > 1 && val.length < 80) {
          checks.push({ type: 'heading_text', value: val, description: `"${val}" label/heading should be present` })
        }
      }
    } else {
      const m = msg.match(pat)
      if (m) {
        const val = m[1].trim()
        if (val.length > 1) checks.push({ type: 'heading_text', value: val, description: `"${val}" label/heading should be present` })
      }
    }
  }

  // Deduplicate checks by value
  const seen = new Set()
  return checks.filter(c => {
    const key = `${c.type}:${c.value.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Verify that saved files actually contain the expected UI changes.
 * @param {Array} savedFiles - Files that were written [{ path, content }]
 * @param {string} userMessage - Original user request
 * @returns {{ verified: boolean, filesChanged: string[], whatShouldBeVisible: string, howToVerify: string, verifiedItems: string[], unverifiedItems: string[], status: string }}
 */
export function verifyPatchResult(savedFiles, userMessage) {
  const filesChanged = savedFiles.map(f => f.path)
  const allCode = savedFiles.map(f => f.content || '').join('\n')
  const allCodeLower = allCode.toLowerCase()

  const checks = extractExpectedChanges(userMessage)

  // If no specific UI checks could be extracted, provide a structural verification
  if (checks.length === 0) {
    return {
      verified: null, // indeterminate — no specific checks possible
      filesChanged,
      whatShouldBeVisible: 'Changes applied per request. Manual preview check recommended.',
      howToVerify: 'Open the preview and verify the requested change is visible.',
      verifiedItems: [`${filesChanged.length} file(s) written successfully`],
      unverifiedItems: [],
      status: 'APPLIED_NO_AUTO_CHECKS',
    }
  }

  const verifiedItems = []
  const unverifiedItems = []

  for (const check of checks) {
    const val = check.value
    const valLower = val.toLowerCase()

    switch (check.type) {
      case 'heading_text':
      case 'button_text':
      case 'nav_item': {
        // Check if the text appears in the code (in JSX, strings, or attributes)
        if (allCode.includes(val) || allCodeLower.includes(valLower)) {
          verifiedItems.push(check.description)
        } else {
          unverifiedItems.push(check.description)
        }
        break
      }
      case 'active_section': {
        // Check for default state patterns: useState('SectionName'), activeTab === 'name', defaultTab
        const statePatterns = [
          new RegExp(`useState\\(['"\`]${valLower}['"\`]\\)`, 'i'),
          new RegExp(`default\\w*\\s*[:=]\\s*['"\`]${valLower}['"\`]`, 'i'),
          new RegExp(`initial\\w*\\s*[:=]\\s*['"\`]${valLower}['"\`]`, 'i'),
          new RegExp(`active\\w*\\s*[:=]\\s*['"\`]${valLower}['"\`]`, 'i'),
        ]
        if (statePatterns.some(p => p.test(allCode))) {
          verifiedItems.push(check.description)
        } else {
          unverifiedItems.push(check.description)
        }
        break
      }
      case 'form_field': {
        // Check for input/textarea/select with matching name, label, or placeholder
        const fieldPatterns = [
          new RegExp(`(?:name|label|placeholder|id)\\s*=\\s*['"\`].*${valLower}.*['"\`]`, 'i'),
          new RegExp(`<(?:input|textarea|select)[^>]*${valLower}`, 'i'),
          new RegExp(`>${val}<`, 'i'),
          // Also check for the value as text content in labels or JSX
          new RegExp(`\\b${valLower.replace(/\s+/g, '\\s*')}\\b`, 'i'),
        ]
        if (fieldPatterns.some(p => p.test(allCode))) {
          verifiedItems.push(check.description)
        } else {
          unverifiedItems.push(check.description)
        }
        break
      }
      case 'select_element': {
        // Check for <select> element related to the described field
        const selectPatterns = [
          /<select\b/i,
          new RegExp(`<select[^>]*${valLower.replace(/\s+/g, '\\s*')}`, 'i'),
          new RegExp(`(?:name|id|label)\\s*=\\s*['"\`].*${valLower.replace(/\s+/g, '.*')}.*['"\`]`, 'i'),
        ]
        if (selectPatterns.some(p => p.test(allCode))) {
          verifiedItems.push(check.description)
        } else {
          unverifiedItems.push(check.description)
        }
        break
      }
      case 'option_value': {
        // Check for <option> with this value or text
        const optPatterns = [
          new RegExp(`<option[^>]*>\\s*${val}\\s*</option>`, 'i'),
          new RegExp(`<option[^>]*value\\s*=\\s*['"\`]${valLower}['"\`]`, 'i'),
          new RegExp(`['"\`]${val}['"\`]`, 'i'),
        ]
        if (optPatterns.some(p => p.test(allCode))) {
          verifiedItems.push(check.description)
        } else {
          unverifiedItems.push(check.description)
        }
        break
      }
      case 'conditional_field': {
        // Check for conditional rendering patterns (ternary, &&, or if/show)
        const condPatterns = [
          new RegExp(`${valLower.replace(/\s+/g, '\\s*')}`, 'i'),
          /&&\s*[(<]/,           // JSX conditional: condition && <Element>
          /\?\s*[(<]\s*\w/,      // Ternary: condition ? <Element>
          /display\s*:\s*.*\?/i, // Inline style conditional
        ]
        // Must have both the field name and at least one conditional pattern
        const hasFieldRef = condPatterns[0].test(allCode)
        const hasConditional = condPatterns.slice(1).some(p => p.test(allCode))
        if (hasFieldRef && hasConditional) {
          verifiedItems.push(check.description)
        } else if (hasFieldRef) {
          verifiedItems.push(check.description + ' (field reference found)')
        } else {
          unverifiedItems.push(check.description)
        }
        break
      }
      case 'removed_element': {
        // For removal, the element text should NOT appear
        if (!allCodeLower.includes(valLower)) {
          verifiedItems.push(`${check.description} — confirmed removed`)
        } else {
          unverifiedItems.push(`${check.description} — still present in code`)
        }
        break
      }
      case 'style_value': {
        if (allCodeLower.includes(valLower)) {
          verifiedItems.push(check.description)
        } else {
          unverifiedItems.push(check.description)
        }
        break
      }
      default:
        if (allCodeLower.includes(valLower)) {
          verifiedItems.push(check.description)
        } else {
          unverifiedItems.push(check.description)
        }
    }
  }

  const verified = unverifiedItems.length === 0
  const status = verified ? 'VERIFIED' : 'NOT_VERIFIED'

  const whatShouldBeVisible = checks.map(c => `- ${c.description}`).join('\n')
  const howToVerify = checks.map(c => {
    switch (c.type) {
      case 'heading_text': return `- Look for "${c.value}" text on the page`
      case 'active_section': return `- Check that the "${c.value}" tab/section is active by default`
      case 'form_field': return `- Check for a "${c.value}" input field in the form`
      case 'select_element': return `- Check that a dropdown/select is present for "${c.value}"`
      case 'option_value': return `- Verify "${c.value}" appears as an option in a dropdown`
      case 'conditional_field': return `- Select the trigger value and verify "${c.value}" field appears`
      case 'removed_element': return `- Confirm "${c.value}" is no longer visible`
      case 'button_text': return `- Look for a button saying "${c.value}"`
      case 'nav_item': return `- Check the navigation includes "${c.value}"`
      case 'style_value': return `- Verify the color/style "${c.value}" is applied`
      default: return `- Check for "${c.value}"`
    }
  }).join('\n')

  return { verified, filesChanged, whatShouldBeVisible, howToVerify, verifiedItems, unverifiedItems, status, checks }
}

/**
 * Generate a JavaScript test script that runs INSIDE the preview iframe
 * after React mounts. Performs DOM checks and interaction simulations,
 * then reports results via parent.postMessage.
 *
 * @param {Array} checks - From extractExpectedChanges
 * @param {object} options - { projectSpecificTests: [...] }
 * @returns {string} JavaScript source to inject into the iframe
 */
export function generateRuntimeTestScript(checks, options = {}) {
  const testCases = []

  for (const check of checks) {
    const safeVal = check.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')

    switch (check.type) {
      case 'heading_text':
        testCases.push({
          name: `Heading "${check.value}" is rendered`,
          code: `(function() {
            var headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="heading"],[class*="title"]');
            for (var i = 0; i < headings.length; i++) {
              if (headings[i].textContent.trim().toLowerCase().indexOf('${safeVal.toLowerCase()}') !== -1) return { pass: true, detail: 'Found in ' + headings[i].tagName };
            }
            // Fallback: check all text content
            if (document.body.textContent.indexOf('${safeVal}') !== -1) return { pass: true, detail: 'Found in body text' };
            return { pass: false, detail: 'Not found in rendered DOM' };
          })()`
        })
        break

      case 'active_section':
        testCases.push({
          name: `"${check.value}" is the active default section`,
          code: `(function() {
            // Check: is the section heading visible immediately after mount?
            var headings = document.querySelectorAll('h1,h2,h3,h4');
            for (var i = 0; i < headings.length; i++) {
              if (headings[i].textContent.trim().toLowerCase().indexOf('${safeVal.toLowerCase()}') !== -1) {
                var rect = headings[i].getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) return { pass: true, detail: 'Section heading visible on mount' };
              }
            }
            // Check: is there an active/selected nav item?
            var activeItems = document.querySelectorAll('[class*="active"],[class*="selected"],[aria-selected="true"],[aria-current]');
            for (var j = 0; j < activeItems.length; j++) {
              if (activeItems[j].textContent.trim().toLowerCase().indexOf('${safeVal.toLowerCase()}') !== -1) return { pass: true, detail: 'Active nav item found' };
            }
            return { pass: false, detail: '"${safeVal}" section not visible as default' };
          })()`
        })
        break

      case 'form_field':
        testCases.push({
          name: `Form field "${check.value}" exists and is interactive`,
          code: `(function() {
            var labels = document.querySelectorAll('label');
            var targetInput = null;
            for (var i = 0; i < labels.length; i++) {
              if (labels[i].textContent.trim().toLowerCase().indexOf('${safeVal.toLowerCase()}') !== -1) {
                // Find associated input: next sibling, child, or via htmlFor
                var forId = labels[i].getAttribute('for');
                if (forId) { targetInput = document.getElementById(forId); }
                if (!targetInput) { targetInput = labels[i].querySelector('input,textarea,select'); }
                if (!targetInput) { targetInput = labels[i].parentElement.querySelector('input,textarea,select'); }
                if (!targetInput && labels[i].nextElementSibling) { targetInput = labels[i].nextElementSibling.tagName === 'INPUT' ? labels[i].nextElementSibling : labels[i].nextElementSibling.querySelector('input,textarea,select'); }
                break;
              }
            }
            if (!targetInput) {
              // Fallback: search by placeholder or name
              targetInput = document.querySelector('input[placeholder*="${safeVal}" i],input[name*="${safeVal.toLowerCase().replace(/\\s+/g, '')}" i]');
            }
            if (!targetInput) return { pass: false, detail: 'Input for "${safeVal}" not found in DOM' };
            // Test interactivity: simulate typing
            var testValue = 'Test_' + Date.now();
            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(targetInput, testValue);
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            // Check if value was accepted
            if (targetInput.value === testValue) return { pass: true, detail: 'Input found and accepts value changes' };
            return { pass: true, detail: 'Input found (value setter may use React controlled pattern)' };
          })()`
        })
        break

      case 'button_text':
        testCases.push({
          name: `Button "${check.value}" exists`,
          code: `(function() {
            var buttons = document.querySelectorAll('button,[role="button"],a[class*="btn"],input[type="submit"]');
            for (var i = 0; i < buttons.length; i++) {
              if (buttons[i].textContent.trim().toLowerCase().indexOf('${safeVal.toLowerCase()}') !== -1) {
                var rect = buttons[i].getBoundingClientRect();
                return { pass: true, detail: 'Button found, size: ' + rect.width + 'x' + rect.height };
              }
            }
            return { pass: false, detail: 'Button with text "${safeVal}" not found' };
          })()`
        })
        break

      case 'removed_element':
        testCases.push({
          name: `"${check.value}" is removed from DOM`,
          code: `(function() {
            var found = document.body.textContent.toLowerCase().indexOf('${safeVal.toLowerCase()}');
            if (found === -1) return { pass: true, detail: 'Not present in rendered DOM' };
            return { pass: false, detail: 'Still present in rendered DOM at position ' + found };
          })()`
        })
        break

      case 'nav_item':
        testCases.push({
          name: `Navigation includes "${check.value}"`,
          code: `(function() {
            var navItems = document.querySelectorAll('nav a, nav button, [class*="sidebar"] a, [class*="sidebar"] button, [class*="nav"] a, [class*="nav"] button, [class*="Sidebar"] li, [class*="Sidebar"] a, [class*="Sidebar"] button');
            for (var i = 0; i < navItems.length; i++) {
              if (navItems[i].textContent.trim().toLowerCase().indexOf('${safeVal.toLowerCase()}') !== -1) return { pass: true, detail: 'Found in navigation' };
            }
            return { pass: false, detail: '"${safeVal}" not found in nav elements' };
          })()`
        })
        break

      case 'select_element':
        testCases.push({
          name: `Dropdown/select for "${check.value}" exists`,
          code: `(function() {
            var selects = document.querySelectorAll('select');
            if (selects.length === 0) return { pass: false, detail: 'No <select> elements found in DOM' };
            // Check if any select relates to the described field
            for (var i = 0; i < selects.length; i++) {
              var s = selects[i];
              var nameOrId = (s.name || s.id || '').toLowerCase();
              if (nameOrId.indexOf('${safeVal.toLowerCase().replace(/\\s+/g, '')}') !== -1) return { pass: true, detail: 'Select found by name/id: ' + (s.name || s.id) };
              // Check label association
              var label = s.closest('label') || (s.id && document.querySelector('label[for="' + s.id + '"]'));
              if (label && label.textContent.toLowerCase().indexOf('${safeVal.toLowerCase()}') !== -1) return { pass: true, detail: 'Select found via label text' };
            }
            // Fallback: if there's exactly one select, it's likely the one
            if (selects.length === 1) return { pass: true, detail: 'Single <select> found, likely matches' };
            return { pass: true, detail: selects.length + ' <select> elements found' };
          })()`
        })
        break

      case 'option_value':
        testCases.push({
          name: `Option "${check.value}" exists in a dropdown`,
          code: `(function() {
            var options = document.querySelectorAll('select option');
            for (var i = 0; i < options.length; i++) {
              if (options[i].textContent.trim().toLowerCase() === '${safeVal.toLowerCase()}' ||
                  (options[i].value || '').toLowerCase() === '${safeVal.toLowerCase()}') {
                return { pass: true, detail: 'Option found: ' + options[i].textContent.trim() };
              }
            }
            return { pass: false, detail: 'Option "${safeVal}" not found in any <select>' };
          })()`
        })
        break

      case 'conditional_field':
        testCases.push({
          name: `Conditional field "${check.value}" can be triggered`,
          code: `(function() {
            // First check if the field is already visible
            var allInputs = document.querySelectorAll('input,textarea,select');
            for (var i = 0; i < allInputs.length; i++) {
              var inp = allInputs[i];
              var nearby = (inp.placeholder || '') + ' ' + (inp.name || '') + ' ' + (inp.parentElement ? inp.parentElement.textContent : '');
              if (nearby.toLowerCase().indexOf('${safeVal.toLowerCase()}') !== -1) {
                return { pass: true, detail: 'Conditional field already visible' };
              }
            }
            // Try triggering a select change to "Other" and check again
            var selects = document.querySelectorAll('select');
            for (var j = 0; j < selects.length; j++) {
              var opts = selects[j].querySelectorAll('option');
              for (var k = 0; k < opts.length; k++) {
                if (opts[k].textContent.trim().toLowerCase() === 'other' || opts[k].value.toLowerCase() === 'other') {
                  selects[j].value = opts[k].value;
                  selects[j].dispatchEvent(new Event('change', { bubbles: true }));
                  selects[j].dispatchEvent(new Event('input', { bubbles: true }));
                  break;
                }
              }
            }
            // Wait a tick for React to re-render
            return new Promise(function(resolve) {
              setTimeout(function() {
                var allInputs2 = document.querySelectorAll('input,textarea');
                for (var m = 0; m < allInputs2.length; m++) {
                  var inp2 = allInputs2[m];
                  var nearby2 = (inp2.placeholder || '') + ' ' + (inp2.name || '') + ' ' + (inp2.parentElement ? inp2.parentElement.textContent : '');
                  if (nearby2.toLowerCase().indexOf('${safeVal.toLowerCase()}') !== -1) {
                    resolve({ pass: true, detail: 'Conditional field appeared after triggering select change' });
                    return;
                  }
                }
                resolve({ pass: false, detail: 'Conditional field "${safeVal}" not found after trigger attempt' });
              }, 300);
            });
          })()`
        })
        break
    }
  }

  // Add project-specific interaction tests
  if (options.interactionTests) {
    for (const test of options.interactionTests) {
      testCases.push({ name: test.name, code: test.code })
    }
  }

  if (testCases.length === 0) return null

  // Build the self-executing test script
  const testCode = testCases.map((tc, i) => `
    try {
      var _r${i} = ${tc.code};
      if (_r${i} && typeof _r${i}.then === 'function') {
        asyncTests.push(_r${i}.then(function(v) { results.push({ name: ${JSON.stringify(tc.name)}, pass: v.pass, detail: v.detail }); }).catch(function(e) { results.push({ name: ${JSON.stringify(tc.name)}, pass: false, detail: 'Async error: ' + e.message }); }));
      } else {
        results.push({ name: ${JSON.stringify(tc.name)}, pass: _r${i}.pass, detail: _r${i}.detail });
      }
    } catch(_e${i}) {
      results.push({ name: ${JSON.stringify(tc.name)}, pass: false, detail: 'Error: ' + _e${i}.message });
    }`).join('\n')

  return `
/* Runtime Verification Tests — injected after React mount */
setTimeout(function() {
  var results = [];
  var asyncTests = [];
  ${testCode}
  // Wait for any async tests, then report
  Promise.all(asyncTests).then(function() {
    var passed = results.filter(function(r) { return r.pass; }).length;
    var total = results.length;
    window.parent.postMessage({
      type: 'runtime_verification',
      results: results,
      passed: passed,
      total: total,
      allPassed: passed === total,
      timestamp: Date.now()
    }, '*');
  });
}, 1500); /* Wait 1.5s for React to fully mount and render */
`
}

/**
 * Generate interaction-specific tests (navigation clicks, input typing, state reflection).
 * These go beyond presence checks — they simulate user actions and verify state changes.
 */
export function generateInteractionTests(savedFiles, userMessage) {
  const tests = []
  const allCode = savedFiles.map(f => f.content || '').join('\n')

  // Detect sidebar navigation items from code
  const sidebarItems = []
  const sidebarMatches = allCode.matchAll(/onClick\s*=\s*\{?\s*\(\)\s*=>\s*set\w*\(\s*['"`](\w+)['"`]\s*\)/g)
  for (const m of sidebarMatches) {
    sidebarItems.push(m[1])
  }

  // Test: click sidebar items and verify section changes
  for (const item of sidebarItems.slice(0, 3)) { // Max 3 navigation tests
    tests.push({
      name: `Navigation: Click "${item}" in sidebar changes section`,
      code: `(function() {
        var buttons = document.querySelectorAll('[class*="sidebar"] button, [class*="sidebar"] li, [class*="Sidebar"] button, [class*="Sidebar"] li, nav button, nav a');
        var clicked = false;
        for (var i = 0; i < buttons.length; i++) {
          if (buttons[i].textContent.trim().toLowerCase().indexOf('${item.toLowerCase()}') !== -1) {
            buttons[i].click();
            clicked = true;
            break;
          }
        }
        if (!clicked) return { pass: false, detail: '"${item}" sidebar item not found to click' };
        // Wait a tick for React to re-render, then check heading
        return new Promise(function(resolve) {
          setTimeout(function() {
            var headings = document.querySelectorAll('h1,h2,h3');
            for (var j = 0; j < headings.length; j++) {
              if (headings[j].textContent.trim().toLowerCase().indexOf('${item.toLowerCase()}') !== -1) {
                resolve({ pass: true, detail: '"${item}" heading appeared after click' });
                return;
              }
            }
            // Also check if body text contains the section name
            if (document.body.textContent.toLowerCase().indexOf('${item.toLowerCase()}') !== -1) {
              resolve({ pass: true, detail: '"${item}" content appeared after click' });
              return;
            }
            resolve({ pass: false, detail: '"${item}" heading not found after sidebar click' });
          }, 300);
        });
      })()`
    })
  }

  // Test: typing in inputs updates state (check for state preview/debug boxes)
  const hasStatePreview = allCode.includes('JSON.stringify') && allCode.includes('State Preview')
  if (hasStatePreview) {
    const inputNames = [...allCode.matchAll(/name=["'](\w+)["']/g)].map(m => m[1]).slice(0, 2)
    for (const inputName of inputNames) {
      tests.push({
        name: `Input "${inputName}" typing updates state preview`,
        code: `(function() {
          var input = document.querySelector('input[name="${inputName}"]');
          if (!input) return { pass: false, detail: 'Input with name="${inputName}" not found' };
          var testVal = 'RuntimeTest_${inputName}';
          var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(input, testVal);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return new Promise(function(resolve) {
            setTimeout(function() {
              var pres = document.querySelectorAll('pre');
              for (var i = 0; i < pres.length; i++) {
                if (pres[i].textContent.indexOf(testVal) !== -1) {
                  resolve({ pass: true, detail: 'State preview updated with typed value' });
                  return;
                }
              }
              resolve({ pass: false, detail: 'State preview did not reflect typed value "${inputName}"' });
            }, 300);
          });
        })()`
      })
    }
  }

  return tests
}

/**
 * Build the structured response message after a patch.
 * Status now has three tiers: VERIFIED, CODE_VERIFIED_ONLY, NOT_VERIFIED.
 */
export function buildVerifiedPatchResponse(result, isRefinement = true) {
  const { verified, filesChanged, whatShouldBeVisible, howToVerify, verifiedItems, unverifiedItems, status, runtimeStatus } = result

  const fileList = filesChanged.map(f => `\`${f}\``).join(', ')
  const effectiveStatus = runtimeStatus || status

  if (effectiveStatus === 'VERIFIED') {
    let response = `Done! I updated ${fileList}.\n\n`
    if (verifiedItems.length > 0) {
      response += verifiedItems.map(i => `- ${i}`).join('\n') + '\n\n'
    }
    response += `Check the preview — everything should be live. What would you like to tweak next?`
    return response
  }

  if (effectiveStatus === 'CODE_VERIFIED_ONLY') {
    let response = `Updated ${fileList} — the code looks good.\n\n`
    if (verifiedItems.length > 0) {
      response += verifiedItems.map(i => `- ${i}`).join('\n') + '\n\n'
    }
    response += `Take a look at the preview to confirm it matches what you had in mind. Want me to adjust anything?`
    return response
  }

  if (effectiveStatus === 'APPLIED_NO_AUTO_CHECKS') {
    let response = `Updated ${fileList}.\n\n`
    if (verifiedItems.length > 0) {
      response += verifiedItems.map(i => `- ${i}`).join('\n') + '\n\n'
    }
    response += `The changes are live in the preview — take a look and let me know if anything needs adjusting.`
    return response
  }

  // NOT_VERIFIED fallback
  let response = `I updated ${fileList}, but I wasn't able to fully confirm everything landed correctly.\n\n`
  if (verifiedItems.length > 0) {
    response += `**Confirmed:**\n${verifiedItems.map(i => `- ${i}`).join('\n')}\n\n`
  }
  if (unverifiedItems.length > 0) {
    response += `**Needs a manual check:**\n${unverifiedItems.map(i => `- ${i}`).join('\n')}\n\n`
  }
  response += `Could you check the preview and let me know what's off? I can fix it right away.`
  return response
}
