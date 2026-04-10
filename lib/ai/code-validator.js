/**
 * Code Completeness Validator
 * 
 * Detects truncated/incomplete code before it gets saved to project files.
 * If code is incomplete, returns a repair prompt for the AI to complete it.
 */

/**
 * Check if JSX/JS/HTML code is structurally complete
 * Returns { valid: true } or { valid: false, reason: string, repairPrompt: string }
 */
export function validateCodeCompleteness(content, filePath) {
  if (!content || typeof content !== 'string') {
    return { valid: false, reason: 'Empty content', repairPrompt: null }
  }

  const ext = filePath?.split('.').pop()?.toLowerCase() || ''
  const isJSX = ['jsx', 'tsx', 'js', 'ts'].includes(ext)
  const isHTML = ['html', 'htm'].includes(ext)
  const isCSS = ['css', 'scss', 'less'].includes(ext)

  // Skip validation for non-code files
  if (!isJSX && !isHTML && !isCSS) return { valid: true }

  const trimmed = content.trim()

  // 1. Check bracket/brace balance
  const braceResult = checkBracketBalance(trimmed)
  if (!braceResult.valid) {
    return {
      valid: false,
      reason: braceResult.reason,
      repairPrompt: buildRepairPrompt(filePath, content, braceResult.reason),
    }
  }

  // 2. JSX-specific: check for unterminated tags
  if (isJSX || isHTML) {
    const tagResult = checkJSXTagBalance(trimmed)
    if (!tagResult.valid) {
      return {
        valid: false,
        reason: tagResult.reason,
        repairPrompt: buildRepairPrompt(filePath, content, tagResult.reason),
      }
    }
  }

  // 3. Check for obvious truncation signals
  const truncResult = checkTruncationSignals(trimmed)
  if (!truncResult.valid) {
    return {
      valid: false,
      reason: truncResult.reason,
      repairPrompt: buildRepairPrompt(filePath, content, truncResult.reason),
    }
  }

  return { valid: true }
}

/**
 * Check that {}, (), [] are balanced (ignoring those inside strings/comments)
 */
function checkBracketBalance(code) {
  const stack = []
  const pairs = { '{': '}', '(': ')', '[': ']' }
  const closers = new Set(['}', ')', ']'])
  let inString = false
  let stringChar = ''
  let inLineComment = false
  let inBlockComment = false
  let inTemplateLiteral = false

  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    const next = code[i + 1]

    // Handle comments
    if (!inString && !inTemplateLiteral && !inBlockComment && ch === '/' && next === '/') {
      inLineComment = true
      continue
    }
    if (inLineComment && ch === '\n') {
      inLineComment = false
      continue
    }
    if (inLineComment) continue

    if (!inString && !inTemplateLiteral && !inLineComment && ch === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    if (inBlockComment && ch === '*' && next === '/') {
      inBlockComment = false
      i++
      continue
    }
    if (inBlockComment) continue

    // Handle template literals
    if (!inString && ch === '`') {
      inTemplateLiteral = !inTemplateLiteral
      continue
    }
    if (inTemplateLiteral) continue

    // Handle strings
    if (!inString && (ch === '"' || ch === "'")) {
      inString = true
      stringChar = ch
      continue
    }
    if (inString && ch === stringChar && code[i - 1] !== '\\') {
      inString = false
      continue
    }
    if (inString) continue

    // Track brackets
    if (pairs[ch]) {
      stack.push(ch)
    } else if (closers.has(ch)) {
      if (stack.length === 0) {
        return { valid: false, reason: `Unexpected closing '${ch}' with no matching opener` }
      }
      const last = stack.pop()
      if (pairs[last] !== ch) {
        return { valid: false, reason: `Mismatched bracket: expected '${pairs[last]}' but found '${ch}'` }
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack.map(b => `'${b}'`).join(', ')
    return { valid: false, reason: `Unclosed brackets: ${unclosed} (${stack.length} unclosed)` }
  }

  return { valid: true }
}

/**
 * Check JSX tag balance — ensures major container tags are closed
 */
function checkJSXTagBalance(code) {
  // Extract JSX tags (simplified — not a full parser)
  const selfClosing = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])
  const tagStack = []

  // Match opening and closing tags
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9.]*)\b[^>]*\/?>/g
  let match

  while ((match = tagRegex.exec(code)) !== null) {
    const fullMatch = match[0]
    const tagName = match[1].toLowerCase()

    // Skip self-closing tags
    if (selfClosing.has(tagName) || fullMatch.endsWith('/>')) continue

    if (fullMatch.startsWith('</')) {
      // Closing tag
      if (tagStack.length > 0 && tagStack[tagStack.length - 1] === tagName) {
        tagStack.pop()
      }
    } else {
      // Opening tag
      tagStack.push(tagName)
    }
  }

  // Allow small imbalances (component names vary), but catch major truncation
  if (tagStack.length > 3) {
    return { valid: false, reason: `JSX has ${tagStack.length} unclosed tags: ${tagStack.slice(-5).join(', ')}` }
  }

  return { valid: true }
}

/**
 * Check for obvious truncation signals
 */
function checkTruncationSignals(code) {
  const lastLine = code.split('\n').filter(l => l.trim()).pop() || ''
  const trimmedLast = lastLine.trim()

  // Code ending mid-attribute or mid-string
  const truncationPatterns = [
    /className="[^"]*$/,         // Unterminated className
    /style=\{\{[^}]*$/,          // Unterminated inline style
    /=\s*["'][^"']*$/,           // Unterminated attribute value
    /\/\*[^*]*$/,                // Unterminated block comment
    /`[^`]*$/,                   // Unterminated template literal at EOF
    /\bfrom\s*$/,                // Import ending with 'from' but no path
    /\bimport\s+\w+\s*$/,       // import Name (no from)
    /\bimport\s*\{[^}]*$/,      // import { unfinished destructure
    /=>\s*$/,                    // Arrow function with no body
    /\bconst\s+\w+\s*=\s*$/,    // Assignment with no value
    /\breturn\s*\(\s*$/,        // Return with open paren
  ]

  for (const pattern of truncationPatterns) {
    if (pattern.test(trimmedLast)) {
      return { valid: false, reason: 'Code appears truncated mid-expression' }
    }
  }

  // JSX/HTML ending without proper closure
  if (trimmedLast.startsWith('<') && !trimmedLast.endsWith('>') && !trimmedLast.includes('//')) {
    return { valid: false, reason: 'Code ends with an incomplete HTML/JSX tag' }
  }

  // JSX file with no export default — likely truncated before the export
  const ext = '' // caller already checks file type; this is a belt-and-suspenders check
  if (code.includes('import ') && !code.includes('export default') && !code.includes('export {') && !code.includes('module.exports')) {
    return { valid: false, reason: 'File has imports but no export — likely truncated before component definition completed' }
  }

  return { valid: true }
}

/**
 * Build a repair prompt that instructs the AI to complete the truncated file
 */
function buildRepairPrompt(filePath, content, reason) {
  // Take the last ~60 lines as context for continuation
  const lines = content.split('\n')
  const contextLines = lines.slice(-60).join('\n')

  return `The file "${filePath}" was generated but is INCOMPLETE (${reason}). Complete the file from where it was cut off. Here are the last lines:\n\n\`\`\`\n${contextLines}\n\`\`\`\n\nIMPORTANT:\n- Output ONLY the complete file content from start to finish\n- Ensure all brackets, braces, parentheses, and JSX tags are properly closed\n- Maintain the same design and style that was started\n- Do NOT add explanatory text, only the code`
}
