/**
 * Model Router — route simple requests to Haiku, complex ones to Sonnet.
 * 
 * Cost savings: Haiku is ~12x cheaper than Sonnet 4.5 for both input and output.
 * Use it for:
 *   - Simple edits (typo fixes, color changes, adding console.logs)
 *   - File reads with no follow-up reasoning
 *   - Quick searches
 * 
 * Use Sonnet for:
 *   - Multi-file refactors
 *   - Debugging complex errors
 *   - Architecture decisions
 *   - Anything involving images/screenshots
 */

/**
 * Classify a user request as 'simple' or 'complex'.
 * Returns { model, reason }.
 */
export function routeModel(userMessage, metadata = {}) {
  const text = typeof userMessage === 'string' ? userMessage : ''
  const lowerText = text.toLowerCase()
  
  // ALWAYS use Sonnet for:
  // 1. Images/screenshots (vision requires Sonnet)
  if (metadata.attachments?.some(a => a?.file_category === 'image' || a?.type?.startsWith('image/'))) {
    return { model: 'claude-sonnet-4-5-20250929', reason: 'vision_required' }
  }
  
  // 2. Multi-turn debugging (user says "still broken", "doesn't work", etc.)
  if (lowerText.match(/still (broken|not working|doesn't work|fails)/)) {
    return { model: 'claude-sonnet-4-5-20250929', reason: 'debugging_context' }
  }
  
  // 3. Architecture/design questions
  if (lowerText.match(/(how (should|do) (i|we)|what's the best way|architecture|design pattern|refactor)/)) {
    return { model: 'claude-sonnet-4-5-20250929', reason: 'architecture_decision' }
  }
  
  // 4. Multi-file operations (mentions multiple files or "all files")
  if (lowerText.match(/(all files|every file|across|throughout|multiple files)/)) {
    return { model: 'claude-sonnet-4-5-20250929', reason: 'multi_file_operation' }
  }
  
  // Use Haiku for simple tasks:
  // 1. Typo fixes
  if (lowerText.match(/(fix (the )?typo|spelling|misspell)/)) {
    return { model: 'claude-haiku-4-5-20251001', reason: 'typo_fix' }
  }
  
  // 2. Color/style changes
  if (lowerText.match(/(change|make|set) (the )?(color|background|font|size|padding|margin)/)) {
    return { model: 'claude-haiku-4-5-20251001', reason: 'style_change' }
  }
  
  // 3. Adding simple logging
  if (lowerText.match(/add (a )?console\.log/)) {
    return { model: 'claude-haiku-4-5-20251001', reason: 'add_logging' }
  }
  
  // 4. Simple file reads (just "show me X" with no follow-up)
  if (lowerText.match(/^(show|read|see|view|open) (me )?(the )?[\w\/\.\-]+(\.(js|jsx|ts|tsx|css|json|md))?$/i)) {
    return { model: 'claude-haiku-4-5-20251001', reason: 'simple_read' }
  }
  
  // 5. Very short requests (under 10 words, likely simple)
  const wordCount = text.trim().split(/\s+/).length
  if (wordCount <= 10 && !lowerText.includes('?')) {
    return { model: 'claude-haiku-4-5-20251001', reason: 'short_request' }
  }
  
  // Default: use Sonnet for anything we're not confident is simple
  return { model: 'claude-sonnet-4-5-20250929', reason: 'default_complex' }
}
