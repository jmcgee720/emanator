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
    /(?:change|update|set|make)\s+(?:the\s+)?(?:heading|title|h1|h2|header)\s+(?:to|say|read)\s+["']?(.+?)["']?(?:\s*[.\n]|$)/i,
    /(?:heading|title|h1|h2)\s+(?:should\s+)?(?:say|read|be)\s+["'](.+?)["']/i,
    /["']([^"']{3,60})["']\s+(?:as\s+)?(?:the\s+)?(?:heading|title|header)/i,
  ]
  for (const pat of headingPatterns) {
    const m = msg.match(pat)
    if (m) checks.push({ type: 'heading_text', value: m[1].trim(), description: `Heading text "${m[1].trim()}" should be present` })
  }

  // 2. Section/tab/page navigation changes
  const sectionPatterns = [
    /(?:default|active|initial|start)\s+(?:section|tab|page|view)\s+(?:to|should\s+be|=)\s+["']?(\w+)["']?/i,
    /(?:show|display|open|start\s+(?:on|with))\s+(?:the\s+)?["']?(\w+)["']?\s+(?:section|tab|page|view)/i,
    /(?:section|tab|page|view)\s+["']?(\w+)["']?\s+(?:should\s+be|as)\s+(?:default|active|selected)/i,
  ]
  for (const pat of sectionPatterns) {
    const m = msg.match(pat)
    if (m) checks.push({ type: 'active_section', value: m[1].trim(), description: `"${m[1].trim()}" section/tab should be the active default` })
  }

  // 3. Form fields
  const formPatterns = [
    /(?:add|include|create)\s+(?:a\s+)?(?:form|input|field|textarea|select)\s+(?:for|called|labeled|with\s+label)\s+["']?(.+?)["']?(?:\s*[.\n,]|$)/i,
    /(?:add|include)\s+(?:a\s+)?["']?(\w+)["']?\s+(?:input|field|form\s+field)/i,
  ]
  for (const pat of formPatterns) {
    const m = msg.match(pat)
    if (m) checks.push({ type: 'form_field', value: m[1].trim(), description: `Form field "${m[1].trim()}" should be present` })
  }

  // 4. Removal requests
  const removePatterns = [
    /(?:remove|delete|hide|get\s+rid\s+of)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:section|button|card|element|component|tab|nav|link|form|header|footer)/i,
    /(?:remove|delete|hide|get\s+rid\s+of)\s+(?:the\s+)?(.+?)(?:\s*[.\n]|$)/i,
  ]
  for (const pat of removePatterns) {
    const m = msg.match(pat)
    if (m && m[1].trim().length < 60) checks.push({ type: 'removed_element', value: m[1].trim(), description: `"${m[1].trim()}" should be removed` })
  }

  // 5. Button/CTA text
  const buttonPatterns = [
    /(?:button|cta)\s+(?:should\s+)?(?:say|read|text)\s+["'](.+?)["']/i,
    /(?:add|change)\s+(?:a\s+)?(?:button|cta)\s+(?:with\s+text|saying|that\s+says)\s+["'](.+?)["']/i,
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

  // 7. Color/style changes (lighter verification — just check the CSS value exists)
  const colorPatterns = [
    /(?:change|set|make)\s+(?:the\s+)?(?:background|bg|color|theme)\s+(?:to|=)\s+["']?([#\w]+)["']?/i,
  ]
  for (const pat of colorPatterns) {
    const m = msg.match(pat)
    if (m) checks.push({ type: 'style_value', value: m[1].trim(), description: `Style value "${m[1].trim()}" should be present in code` })
  }

  return checks
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
        ]
        if (fieldPatterns.some(p => p.test(allCode))) {
          verifiedItems.push(check.description)
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
      case 'removed_element': return `- Confirm "${c.value}" is no longer visible`
      case 'button_text': return `- Look for a button saying "${c.value}"`
      case 'nav_item': return `- Check the navigation includes "${c.value}"`
      case 'style_value': return `- Verify the color/style "${c.value}" is applied`
      default: return `- Check for "${c.value}"`
    }
  }).join('\n')

  return { verified, filesChanged, whatShouldBeVisible, howToVerify, verifiedItems, unverifiedItems, status }
}

/**
 * Build the structured response message after a patch.
 * @param {object} result - Output from verifyPatchResult
 * @param {boolean} isRefinement - Whether this is a refinement (edit) vs new build
 * @returns {string} Formatted response message
 */
export function buildVerifiedPatchResponse(result, isRefinement = true) {
  const { verified, filesChanged, whatShouldBeVisible, howToVerify, verifiedItems, unverifiedItems, status } = result

  let response = ''

  // FILES CHANGED
  response += `**FILES CHANGED:** ${filesChanged.join(', ')}\n\n`

  // WHAT SHOULD NOW BE VISIBLE
  response += `**WHAT SHOULD NOW BE VISIBLE:**\n${whatShouldBeVisible}\n\n`

  // HOW TO VERIFY IN PREVIEW
  response += `**HOW TO VERIFY IN PREVIEW:**\n${howToVerify}\n\n`

  // VERIFICATION STATUS
  if (status === 'APPLIED_NO_AUTO_CHECKS') {
    response += `**VERIFICATION STATUS:** PATCH APPLIED — manual preview check recommended.\n`
    if (verifiedItems.length > 0) {
      response += `${verifiedItems.map(i => `- ${i}`).join('\n')}\n`
    }
  } else if (verified) {
    response += `**VERIFICATION STATUS:** VERIFIED\n`
    response += verifiedItems.map(i => `- ${i}`).join('\n') + '\n'
  } else {
    response += `**VERIFICATION STATUS:** PATCH APPLIED BUT NOT VERIFIED\n`
    if (verifiedItems.length > 0) {
      response += `Confirmed:\n${verifiedItems.map(i => `- ${i}`).join('\n')}\n\n`
    }
    response += `Could not confirm:\n${unverifiedItems.map(i => `- ${i}`).join('\n')}\n\n`
    response += `The patch compiled and files were saved, but the requested visible changes could not be fully confirmed in the code. Try a smaller, more specific follow-up request targeting the unverified items above.`
  }

  return response
}
